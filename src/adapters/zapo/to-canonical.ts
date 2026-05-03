import { encodeSenderKeyRecord, encodeSignalSessionRecord } from 'zapo-js/signal'

import { toBase64 } from '@codec/bytes'
import {
    emptySnapshot,
    type IrAddress,
    irAddressKey,
    type IrAppStateSyncKey,
    type IrContact,
    type IrDeviceList,
    type IrGroupSender,
    irGroupSenderKey,
    type IrIdentity,
    type IrLTHashState,
    type IrMessageSecret,
    type IrPreKey,
    type IrPrivacyToken,
    type IrSignedPreKey,
    type WaSnapshot
} from '@ir'

import type { ZapoSignalAddress, ZapoStoreSnapshot } from './types.js'

function addrKey(a: ZapoSignalAddress): string {
    return irAddressKey(toIrAddress(a))
}

function toIrAddress(a: ZapoSignalAddress): IrAddress {
    const out: { user: string; device: number; server?: 'lid' | 's.whatsapp.net' } = {
        user: a.user,
        device: a.device
    }
    if (a.server === 'lid' || a.server === 's.whatsapp.net') out.server = a.server
    return out
}

function toIrGroupSender(groupId: string, sender: ZapoSignalAddress): IrGroupSender {
    return { groupId, sender: toIrAddress(sender) }
}

function identityFromCreds(input: ZapoStoreSnapshot): IrIdentity {
    const c = input.credentials
    return {
        noiseKeyPair: c.noiseKeyPair,
        signedIdentityKeyPair: c.registrationInfo.identityKeyPair,
        registrationId: c.registrationInfo.registrationId,
        advSecretKey: c.advSecretKey,
        ...(c.signedIdentity
            ? {
                  signedIdentity: {
                      ...(c.signedIdentity.details ? { details: c.signedIdentity.details } : {}),
                      ...(c.signedIdentity.accountSignatureKey
                          ? { accountSignatureKey: c.signedIdentity.accountSignatureKey }
                          : {}),
                      ...(c.signedIdentity.accountSignature
                          ? { accountSignature: c.signedIdentity.accountSignature }
                          : {}),
                      ...(c.signedIdentity.deviceSignature
                          ? { deviceSignature: c.signedIdentity.deviceSignature }
                          : {})
                  }
              }
            : {}),
        ...(c.meJid ? { meJid: c.meJid } : {}),
        ...(c.meLid ? { meLid: c.meLid } : {}),
        ...(c.meDisplayName ? { meDisplayName: c.meDisplayName } : {}),
        ...(c.platform ? { platform: c.platform } : {}),
        ...(c.routingInfo ? { routingInfo: c.routingInfo } : {}),
        ...(c.accountCreationTs !== undefined ? { accountCreationTs: c.accountCreationTs } : {})
    }
}

function signedPreKey(input: ZapoStoreSnapshot): IrSignedPreKey {
    const spk = input.credentials.signedPreKey
    return {
        keyId: spk.keyId,
        keyPair: spk.keyPair,
        signature: spk.signature,
        ...(spk.uploaded !== undefined ? { uploaded: spk.uploaded } : { uploaded: true })
    }
}

export function zapoToCanonical(input: ZapoStoreSnapshot): WaSnapshot {
    const snap = emptySnapshot('zapo', identityFromCreds(input), signedPreKey(input))

    if (input.preKeys) {
        for (const k of input.preKeys) {
            const pre: IrPreKey = {
                keyId: k.keyId,
                keyPair: k.keyPair,
                ...(k.uploaded !== undefined ? { uploaded: k.uploaded } : {})
            }
            snap.preKeys.set(k.keyId, pre)
        }
    }

    if (input.identities) {
        for (const id of input.identities) {
            snap.signalIdentities.set(addrKey(id.address), id.identityKey)
        }
    }

    if (input.sessions) {
        for (const s of input.sessions) {
            const proto = encodeSignalSessionRecord(
                s.record as Parameters<typeof encodeSignalSessionRecord>[0]
            )
            const irAddr = toIrAddress(s.address)
            snap.sessions.set(irAddressKey(irAddr), { address: irAddr, record: { proto } })
        }
    }

    if (input.senderKeys) {
        for (const sk of input.senderKeys) {
            const proto = encodeSenderKeyRecord(
                sk.record as Parameters<typeof encodeSenderKeyRecord>[0]
            )
            const groupSender = toIrGroupSender(sk.groupId, sk.sender)
            snap.senderKeys.set(irGroupSenderKey(groupSender), { groupSender, record: { proto } })
        }
    }

    if (input.appState) {
        for (const k of input.appState.keys) {
            const ir: IrAppStateSyncKey = {
                keyId: k.keyId,
                keyData: k.keyData,
                timestamp: k.timestamp,
                ...(k.fingerprint ? { fingerprint: k.fingerprint } : {})
            }
            snap.appStateSyncKeys.set(toBase64(k.keyId), ir)
        }
        for (const [collection, v] of Object.entries(input.appState.collections)) {
            const indexValueMap = new Map<string, Uint8Array>()
            for (const [k2, v2] of Object.entries(v.indexValueMap)) indexValueMap.set(k2, v2)
            const lthash: IrLTHashState = {
                collection,
                version: v.version,
                hash: v.hash,
                indexValueMap
            }
            snap.appStateVersions.set(collection, lthash)
        }
    }

    if (input.privacyTokens) {
        for (const t of input.privacyTokens) {
            const pt: IrPrivacyToken = {
                jid: t.jid,
                ...(t.tcToken ? { token: t.tcToken } : {}),
                ...(t.tcTokenTimestamp !== undefined ? { timestampMs: t.tcTokenTimestamp } : {}),
                ...(t.tcTokenSenderTimestamp !== undefined
                    ? { senderTimestampMs: t.tcTokenSenderTimestamp }
                    : {}),
                ...(t.nctSalt ? { nctSalt: t.nctSalt } : {})
            }
            snap.privacyTokens.set(t.jid, pt)
        }
    }

    if (input.deviceLists) {
        for (const dl of input.deviceLists) {
            const ir: IrDeviceList = {
                userJid: dl.userJid,
                deviceJids: dl.deviceJids,
                updatedAtMs: dl.updatedAtMs
            }
            snap.deviceLists.set(dl.userJid, ir)
        }
    }

    if (input.contacts) {
        for (const c of input.contacts) {
            const ir: IrContact = {
                jid: c.jid,
                ...(c.displayName ? { displayName: c.displayName } : {}),
                ...(c.pushName ? { pushName: c.pushName } : {}),
                ...(c.lid ? { lid: c.lid } : {}),
                ...(c.phoneNumber ? { phoneNumber: c.phoneNumber } : {}),
                lastUpdatedMs: c.lastUpdatedMs
            }
            snap.contacts.set(c.jid, ir)
        }
    }

    if (input.messageSecrets) {
        for (const m of input.messageSecrets) {
            const ir: IrMessageSecret = {
                messageId: m.messageId,
                senderJid: m.senderJid,
                secret: m.secret
            }
            snap.messageSecrets.set(m.messageId, ir)
        }
    }

    return snap
}
