import { toLibsignalAddress } from '@codec/address'
import { toBase64 } from '@codec/bytes'
import type { WaSnapshot } from '@ir'

import { protoToBaileysSenderKey } from './sender-key.js'
import { protoToBaileysSession } from './session.js'
import type {
    BaileysAuthenticationCreds,
    BaileysAuthSnapshot,
    BaileysSignalDataSet
} from './types.js'

function nextPreKeyId(snap: WaSnapshot): { firstUnuploadedPreKeyId: number; nextPreKeyId: number } {
    if (snap.preKeys.size === 0) {
        return { firstUnuploadedPreKeyId: 1, nextPreKeyId: 1 }
    }
    let maxId = 0
    let firstUnuploaded = Number.POSITIVE_INFINITY
    for (const k of snap.preKeys.values()) {
        if (k.keyId > maxId) maxId = k.keyId
        if (!k.uploaded && k.keyId < firstUnuploaded) firstUnuploaded = k.keyId
    }
    return {
        firstUnuploadedPreKeyId: Number.isFinite(firstUnuploaded) ? firstUnuploaded : maxId + 1,
        nextPreKeyId: maxId + 1
    }
}

function credsFromSnapshot(snap: WaSnapshot): BaileysAuthenticationCreds {
    const id = snap.identity
    const spk = snap.signedPreKey
    const { firstUnuploadedPreKeyId, nextPreKeyId: nextId } = nextPreKeyId(snap)
    const creds: BaileysAuthenticationCreds = {
        noiseKey: { public: id.noiseKeyPair.pubKey, private: id.noiseKeyPair.privKey },
        // Required field; not load-bearing once authenticated — regenerated on
        // any future re-pair.
        pairingEphemeralKeyPair: { public: new Uint8Array(32), private: new Uint8Array(32) },
        signedIdentityKey: {
            public: id.signedIdentityKeyPair.pubKey,
            private: id.signedIdentityKeyPair.privKey
        },
        signedPreKey: {
            keyPair: { public: spk.keyPair.pubKey, private: spk.keyPair.privKey },
            signature: spk.signature,
            keyId: spk.keyId,
            ...(spk.timestampS !== undefined ? { timestampS: spk.timestampS } : {})
        },
        registrationId: id.registrationId,
        advSecretKey: toBase64(id.advSecretKey),
        ...(id.signedIdentity
            ? {
                  account: {
                      ...(id.signedIdentity.details ? { details: id.signedIdentity.details } : {}),
                      ...(id.signedIdentity.accountSignatureKey
                          ? { accountSignatureKey: id.signedIdentity.accountSignatureKey }
                          : {}),
                      ...(id.signedIdentity.accountSignature
                          ? { accountSignature: id.signedIdentity.accountSignature }
                          : {}),
                      ...(id.signedIdentity.deviceSignature
                          ? { deviceSignature: id.signedIdentity.deviceSignature }
                          : {})
                  }
              }
            : {}),
        ...(id.meJid
            ? {
                  me: {
                      id: id.meJid,
                      ...(id.meLid ? { lid: id.meLid } : {}),
                      ...(id.meDisplayName ? { name: id.meDisplayName } : {})
                  }
              }
            : {}),
        ...(snap.signalIdentities.size > 0
            ? {
                  signalIdentities: [...snap.signalIdentities].map(([key, identifierKey]) => {
                      // IR key shape `<user>[@<server>][_<agent>]:<device>`
                      // → baileys `identifier.name = <user>@<server>` (no agent).
                      const colon = key.lastIndexOf(':')
                      const head = colon >= 0 ? key.slice(0, colon) : key
                      const deviceId = colon >= 0 ? Number(key.slice(colon + 1)) : 0
                      const underscore = head.indexOf('_')
                      const cleaned = underscore >= 0 ? head.slice(0, underscore) : head
                      const name = cleaned.includes('@') ? cleaned : `${cleaned}@s.whatsapp.net`
                      return { identifier: { name, deviceId }, identifierKey }
                  })
              }
            : {}),
        firstUnuploadedPreKeyId,
        nextPreKeyId: nextId,
        ...(id.platform ? { platform: id.platform } : {}),
        ...(id.routingInfo ? { routingInfo: id.routingInfo } : {}),
        ...(id.accountSyncCounter !== undefined
            ? { accountSyncCounter: id.accountSyncCounter }
            : {})
    }
    return creds
}

function keysFromSnapshot(snap: WaSnapshot): BaileysSignalDataSet {
    const out: {
        'pre-key'?: Record<string, { public: Uint8Array; private: Uint8Array }>
        session?: Record<string, unknown>
        'sender-key'?: Record<string, unknown>
        'app-state-sync-key'?: Record<
            string,
            { keyData: Uint8Array; fingerprint?: unknown; timestamp?: number }
        >
        'app-state-sync-version'?: Record<
            string,
            {
                version: number
                hash: Uint8Array
                indexValueMap: Record<string, { valueMac: Uint8Array }>
            }
        >
        tctoken?: Record<string, { token: Uint8Array; timestamp?: string }>
        'device-list'?: Record<string, readonly string[]>
        'identity-key'?: Record<string, Uint8Array>
    } = {}

    if (snap.sessions.size > 0) {
        const dict: Record<string, unknown> = {}
        for (const { address, record } of snap.sessions.values()) {
            dict[toLibsignalAddress(address)] = protoToBaileysSession(record.proto)
        }
        out.session = dict
    }

    if (snap.senderKeys.size > 0) {
        const dict: Record<string, unknown> = {}
        for (const { groupSender, record } of snap.senderKeys.values()) {
            // SenderKeyName.serialize() = `${groupId}::${sender.id}::${deviceId}`.
            // sender.id carries any `_<agent>` and `@<server>` suffix; device
            // is its own segment.
            const senderId =
                (groupSender.sender.server
                    ? `${groupSender.sender.user}@${groupSender.sender.server}`
                    : groupSender.sender.user) +
                (groupSender.sender.agent !== undefined ? `_${groupSender.sender.agent}` : '')
            const key = `${groupSender.groupId}::${senderId}::${groupSender.sender.device}`
            dict[key] = protoToBaileysSenderKey(
                record.proto,
                groupSender.groupId,
                groupSender.sender
            )
        }
        out['sender-key'] = dict
    }

    if (snap.preKeys.size > 0) {
        const dict: Record<string, { public: Uint8Array; private: Uint8Array }> = {}
        for (const k of snap.preKeys.values()) {
            dict[String(k.keyId)] = { public: k.keyPair.pubKey, private: k.keyPair.privKey }
        }
        out['pre-key'] = dict
    }

    if (snap.appStateSyncKeys.size > 0) {
        const dict: Record<
            string,
            { keyData: Uint8Array; fingerprint?: unknown; timestamp?: number }
        > = {}
        for (const [keyIdB64, k] of snap.appStateSyncKeys) {
            const entry: { keyData: Uint8Array; fingerprint?: unknown; timestamp?: number } = {
                keyData: k.keyData
            }
            if (k.fingerprint) entry.fingerprint = k.fingerprint
            if (k.timestamp !== undefined) entry.timestamp = k.timestamp
            dict[keyIdB64] = entry
        }
        out['app-state-sync-key'] = dict
    }

    if (snap.appStateVersions.size > 0) {
        const dict: Record<
            string,
            {
                version: number
                hash: Uint8Array
                indexValueMap: Record<string, { valueMac: Uint8Array }>
            }
        > = {}
        for (const [collection, st] of snap.appStateVersions) {
            const indexValueMap: Record<string, { valueMac: Uint8Array }> = {}
            for (const [k, v] of st.indexValueMap) indexValueMap[k] = { valueMac: v }
            dict[collection] = { version: st.version, hash: st.hash, indexValueMap }
        }
        out['app-state-sync-version'] = dict
    }

    if (snap.privacyTokens.size > 0) {
        const dict: Record<string, { token: Uint8Array; timestamp?: string }> = {}
        for (const [jid, tok] of snap.privacyTokens) {
            if (!tok.token) continue
            const entry: { token: Uint8Array; timestamp?: string } = { token: tok.token }
            if (tok.timestampMs !== undefined)
                entry.timestamp = String(Math.floor(tok.timestampMs / 1000))
            dict[jid] = entry
        }
        out.tctoken = dict
    }

    if (snap.deviceLists.size > 0) {
        const dict: Record<string, readonly string[]> = {}
        for (const [user, dl] of snap.deviceLists) dict[user] = dl.deviceJids
        out['device-list'] = dict
    }

    if (snap.signalIdentities.size > 0) {
        const dict: Record<string, Uint8Array> = {}
        for (const [k, v] of snap.signalIdentities) dict[k] = v
        out['identity-key'] = dict
    }

    return out as BaileysSignalDataSet
}

export function baileysFromCanonical(snap: WaSnapshot): BaileysAuthSnapshot {
    return {
        creds: credsFromSnapshot(snap),
        keys: keysFromSnapshot(snap)
    }
}
