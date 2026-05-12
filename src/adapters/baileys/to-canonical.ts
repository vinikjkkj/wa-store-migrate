import { parseLibsignalAddress } from '@codec/address'
import { bufferJsonReviver } from '@codec/buffer-json'
import { asBytes, fromBase64 } from '@codec/bytes'
import {
    emptySnapshot,
    irAddressKey,
    type IrAppStateSyncKey,
    type IrContact,
    type IrDeviceList,
    irGroupSenderKey,
    type IrIdentity,
    type IrLTHashState,
    type IrPreKey,
    type IrPrivacyToken,
    type IrSignedPreKey,
    type WaSnapshot
} from '@ir'

import { fromBaileysProtocolAddress, fromBaileysSenderKeyName } from './address.js'
import { baileysSenderKeyToProto } from './sender-key.js'
import type { BaileysSerializedSenderKey, BaileysSerializedSessionRecord } from './session-types.js'
import { type BaileysSessionLocal, baileysSessionToProto } from './session.js'
import type {
    BaileysAuthenticationCreds,
    BaileysAuthSnapshot,
    BaileysSenderKeyValue,
    BaileysSessionValue,
    BaileysSignalDataSet
} from './types.js'

function decodeSessionValue(v: BaileysSessionValue, field: string): BaileysSerializedSessionRecord {
    if (v instanceof Uint8Array) {
        const text = Buffer.from(v).toString('utf-8')
        try {
            return JSON.parse(text) as BaileysSerializedSessionRecord
        } catch (e) {
            throw new Error(`${field}: failed to parse JSON session blob (${(e as Error).message})`)
        }
    }
    return v
}

function decodeSenderKeyValue(v: BaileysSenderKeyValue, field: string): BaileysSerializedSenderKey {
    if (v instanceof Uint8Array) {
        const text = Buffer.from(v).toString('utf-8')
        try {
            // baileys stores via `JSON.stringify(states, BufferJSON.replacer)`.
            const parsed = JSON.parse(text, bufferJsonReviver)
            if (!Array.isArray(parsed)) throw new Error('expected SenderKeyStateStructure[]')
            return parsed as BaileysSerializedSenderKey
        } catch (e) {
            throw new Error(
                `${field}: failed to parse JSON sender-key blob (${(e as Error).message})`
            )
        }
    }
    return v
}

function identityFromCreds(creds: BaileysAuthenticationCreds): IrIdentity {
    const me = creds.me
    return {
        noiseKeyPair: { pubKey: creds.noiseKey.public, privKey: creds.noiseKey.private },
        signedIdentityKeyPair: {
            pubKey: creds.signedIdentityKey.public,
            privKey: creds.signedIdentityKey.private
        },
        registrationId: creds.registrationId,
        advSecretKey: fromBase64(creds.advSecretKey),
        ...(creds.account
            ? {
                  // creds.json may store `account.*` as raw base64 strings
                  // instead of `{type:'Buffer',data:...}`; `asBytes` accepts both.
                  signedIdentity: {
                      ...(creds.account.details
                          ? {
                                details: asBytes(creds.account.details, 'creds.account.details')
                            }
                          : {}),
                      ...(creds.account.accountSignatureKey
                          ? {
                                accountSignatureKey: asBytes(
                                    creds.account.accountSignatureKey,
                                    'creds.account.accountSignatureKey'
                                )
                            }
                          : {}),
                      ...(creds.account.accountSignature
                          ? {
                                accountSignature: asBytes(
                                    creds.account.accountSignature,
                                    'creds.account.accountSignature'
                                )
                            }
                          : {}),
                      ...(creds.account.deviceSignature
                          ? {
                                deviceSignature: asBytes(
                                    creds.account.deviceSignature,
                                    'creds.account.deviceSignature'
                                )
                            }
                          : {})
                  }
              }
            : {}),
        ...(me?.id ? { meJid: me.id } : {}),
        ...(me?.lid ? { meLid: me.lid } : {}),
        ...((me?.name ?? me?.notify) ? { meDisplayName: me?.name ?? me?.notify } : {}),
        ...(creds.platform ? { platform: creds.platform } : {}),
        ...(creds.routingInfo ? { routingInfo: creds.routingInfo } : {}),
        ...(creds.accountSyncCounter !== undefined
            ? { accountSyncCounter: creds.accountSyncCounter }
            : {})
    }
}

function signedPreKeyFromCreds(creds: BaileysAuthenticationCreds): IrSignedPreKey {
    return {
        keyId: creds.signedPreKey.keyId,
        keyPair: {
            pubKey: creds.signedPreKey.keyPair.public,
            privKey: creds.signedPreKey.keyPair.private
        },
        signature: creds.signedPreKey.signature,
        ...(creds.signedPreKey.timestampS !== undefined
            ? { timestampS: creds.signedPreKey.timestampS }
            : {}),
        uploaded: true
    }
}

function preKeysFromKeys(
    keys: BaileysSignalDataSet,
    firstUnuploaded: number
): Map<number, IrPreKey> {
    const out = new Map<number, IrPreKey>()
    const dict = keys['pre-key']
    if (!dict) return out
    for (const [idStr, kp] of Object.entries(dict)) {
        if (!kp) continue
        const keyId = Number(idStr)
        if (!Number.isFinite(keyId)) continue
        out.set(keyId, {
            keyId,
            keyPair: { pubKey: kp.public, privKey: kp.private },
            uploaded: keyId < firstUnuploaded
        })
    }
    return out
}

function signalIdentitiesFromCreds(creds: BaileysAuthenticationCreds): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>()
    if (!creds.signalIdentities) return out
    for (const id of creds.signalIdentities) {
        const addr = parseLibsignalAddress(`${id.identifier.name}:${id.identifier.deviceId}`)
        out.set(irAddressKey(addr), id.identifierKey)
    }
    return out
}

function appStateSyncKeysFromKeys(keys: BaileysSignalDataSet): Map<string, IrAppStateSyncKey> {
    const out = new Map<string, IrAppStateSyncKey>()
    const dict = keys['app-state-sync-key']
    if (!dict) return out
    for (const [keyIdB64, payload] of Object.entries(dict)) {
        if (!payload?.keyData) continue
        const keyId = fromBase64(keyIdB64)
        const ts =
            typeof payload.timestamp === 'string' ? Number(payload.timestamp) : payload.timestamp
        out.set(keyIdB64, {
            keyId,
            keyData: asBytes(payload.keyData, `app-state-sync-key[${keyIdB64}].keyData`),
            ...(ts !== undefined && Number.isFinite(ts) ? { timestamp: ts } : {}),
            ...(payload.fingerprint ? { fingerprint: payload.fingerprint } : {})
        })
    }
    return out
}

function appStateVersionsFromKeys(keys: BaileysSignalDataSet): Map<string, IrLTHashState> {
    const out = new Map<string, IrLTHashState>()
    const dict = keys['app-state-sync-version']
    if (!dict) return out
    for (const [collection, state] of Object.entries(dict)) {
        if (!state) continue
        const indexValueMap = new Map<string, Uint8Array>()
        for (const [indexMacB64, entry] of Object.entries(state.indexValueMap)) {
            indexValueMap.set(
                indexMacB64,
                asBytes(entry.valueMac, `${collection}.indexValueMap[${indexMacB64}]`)
            )
        }
        out.set(collection, {
            collection,
            version: state.version,
            hash: asBytes(state.hash, `${collection}.hash`),
            indexValueMap
        })
    }
    return out
}

function privacyTokensFromKeys(keys: BaileysSignalDataSet): Map<string, IrPrivacyToken> {
    const out = new Map<string, IrPrivacyToken>()
    const dict = keys.tctoken
    if (!dict) return out
    for (const [jid, entry] of Object.entries(dict)) {
        if (!entry) continue
        const ts = typeof entry.timestamp === 'string' ? Number(entry.timestamp) : entry.timestamp
        out.set(jid, {
            jid,
            token: asBytes(entry.token, `tctoken[${jid}].token`),
            ...(ts !== undefined && Number.isFinite(ts) ? { timestampMs: ts * 1000 } : {})
        })
    }
    return out
}

function deviceListsFromKeys(keys: BaileysSignalDataSet): Map<string, IrDeviceList> {
    const out = new Map<string, IrDeviceList>()
    const dict = keys['device-list']
    if (!dict) return out
    for (const [userJid, deviceJids] of Object.entries(dict)) {
        if (!deviceJids) continue
        out.set(userJid, {
            userJid,
            deviceJids: [...deviceJids],
            updatedAtMs: 0
        })
    }
    return out
}

function contactsFromCreds(creds: BaileysAuthenticationCreds): Map<string, IrContact> {
    const out = new Map<string, IrContact>()
    const me = creds.me
    if (me?.id) {
        const c: IrContact = {
            jid: me.id,
            ...((me.name ?? me.notify) ? { displayName: me.name ?? me.notify } : {}),
            ...(me.notify ? { pushName: me.notify } : {}),
            ...(me.verifiedName ? { verifiedName: me.verifiedName } : {}),
            ...(me.lid ? { lid: me.lid } : {})
        }
        out.set(me.id, c)
    }
    return out
}

/** Snapshot from baileys' `AuthenticationState`. */
export function baileysToCanonical(input: BaileysAuthSnapshot): WaSnapshot {
    const identity = identityFromCreds(input.creds)
    const signedPreKeyIr = signedPreKeyFromCreds(input.creds)
    const snap = emptySnapshot('baileys', identity, signedPreKeyIr)
    snap.preKeys = preKeysFromKeys(input.keys, input.creds.firstUnuploadedPreKeyId)
    snap.signalIdentities = signalIdentitiesFromCreds(input.creds)
    snap.appStateSyncKeys = appStateSyncKeysFromKeys(input.keys)
    snap.appStateVersions = appStateVersionsFromKeys(input.keys)
    snap.privacyTokens = privacyTokensFromKeys(input.keys)
    snap.deviceLists = deviceListsFromKeys(input.keys)
    snap.contacts = contactsFromCreds(input.creds)

    const local: BaileysSessionLocal = {
        regId: input.creds.registrationId,
        identityPubKey: input.creds.signedIdentityKey.public
    }

    const sessionDict = input.keys.session
    if (sessionDict) {
        for (const [addrStr, value] of Object.entries(sessionDict)) {
            if (!value) continue
            const serialized = decodeSessionValue(value, `session[${addrStr}]`)
            const proto = baileysSessionToProto(serialized, local)
            const irAddr = parseBaileysSessionKey(addrStr)
            snap.sessions.set(irAddressKey(irAddr), { address: irAddr, record: { proto } })
        }
    }

    const senderKeyDict = input.keys['sender-key']
    if (senderKeyDict) {
        for (const [encoded, value] of Object.entries(senderKeyDict)) {
            if (!value) continue
            const states = decodeSenderKeyValue(value, `sender-key[${encoded}]`)
            const parsed = fromBaileysSenderKeyName(encoded)
            if (!parsed) continue
            const { groupId, sender } = parsed
            const proto = baileysSenderKeyToProto(states, groupId, sender)
            const groupSender = { groupId, sender }
            snap.senderKeys.set(irGroupSenderKey(groupSender), { groupSender, record: { proto } })
        }
    }

    return snap
}

function parseBaileysSessionKey(key: string): ReturnType<typeof parseLibsignalAddress> {
    if (key.includes('.') && !key.includes('@')) {
        return fromBaileysProtocolAddress(key)
    }
    return parseLibsignalAddress(key)
}
