// Portable wire format for WaSnapshot — plain JSON, no Maps or Uint8Arrays.
// - Bytes are encoded as raw base64 strings.
// - Maps are encoded as arrays of `[key, value]` pairs (preserves number keys).
// - Optional fields are omitted when absent.
//
// This format is the contract for non-TS consumers (Go/Rust services reading
// IR JSON from disk/S3). See docs/IR.md.

import type { IrAddress, IrGroupSender } from './address.js'
import type { IrSenderKeyRecord, IrSessionRecord } from './session.js'
import {
    emptySnapshot,
    type IrAppStateSyncKey,
    type IrContact,
    type IrDeviceList,
    type IrIdentity,
    type IrKeyPair,
    type IrLTHashState,
    type IrMessageSecret,
    type IrPreKey,
    type IrPrivacyToken,
    type IrSenderKeyDistribution,
    type IrSignedIdentity,
    type IrSignedPreKey,
    type LibId,
    type WaSnapshot,
    type WaSnapshotMutable
} from './snapshot.js'

type Base64 = string

export interface IrKeyPairJson {
    pubKey: Base64
    privKey: Base64
}

export interface IrSignedPreKeyJson {
    keyId: number
    keyPair: IrKeyPairJson
    signature: Base64
    timestampS?: number
    uploaded?: boolean
}

export interface IrPreKeyJson {
    keyId: number
    keyPair: IrKeyPairJson
    uploaded?: boolean
}

export interface IrSignedIdentityJson {
    details?: Base64
    accountSignatureKey?: Base64
    accountSignature?: Base64
    deviceSignature?: Base64
}

export interface IrIdentityJson {
    noiseKeyPair: IrKeyPairJson
    signedIdentityKeyPair: IrKeyPairJson
    registrationId: number
    advSecretKey: Base64
    signedIdentity?: IrSignedIdentityJson
    meJid?: string
    meLid?: string
    meDisplayName?: string
    platform?: string
    routingInfo?: Base64
    accountSyncCounter?: number
    accountCreationTs?: number
}

export interface IrSessionRecordJson {
    proto: Base64
}

export interface IrSenderKeyRecordJson {
    proto: Base64
}

export interface IrSenderKeyDistributionJson {
    groupSender: IrGroupSender
    keyId: number
    timestampMs: number
}

export interface IrAppStateSyncKeyJson {
    keyId: Base64
    keyData: Base64
    timestamp?: number
    fingerprint?: {
        rawId?: number
        currentIndex?: number
        deviceIndexes?: readonly number[]
    }
}

export interface IrLTHashStateJson {
    collection: string
    version: number
    hash: Base64
    indexValueMap: Array<[string, Base64]>
}

export interface IrPrivacyTokenJson {
    jid: string
    token?: Base64
    timestampMs?: number
    senderTimestampMs?: number
    nctSalt?: Base64
}

export interface IrMessageSecretJson {
    messageId: string
    senderJid: string
    chatJid?: string
    secret: Base64
}

export interface WaSnapshotJson {
    schemaVersion: 1
    source: LibId
    identity: IrIdentityJson
    signedPreKey: IrSignedPreKeyJson
    preKeys: Array<[number, IrPreKeyJson]>
    signalIdentities: Array<[string, Base64]>
    sessions: Array<[string, { address: IrAddress; record: IrSessionRecordJson }]>
    senderKeys: Array<[string, { groupSender: IrGroupSender; record: IrSenderKeyRecordJson }]>
    senderKeyDistributions: Array<[string, IrSenderKeyDistributionJson]>
    appStateSyncKeys: Array<[string, IrAppStateSyncKeyJson]>
    appStateVersions: Array<[string, IrLTHashStateJson]>
    privacyTokens: Array<[string, IrPrivacyTokenJson]>
    deviceLists: Array<[string, IrDeviceList]>
    contacts: Array<[string, IrContact]>
    messageSecrets: Array<[string, IrMessageSecretJson]>
}

const enc = (b: Uint8Array): Base64 => Buffer.from(b).toString('base64')
const dec = (s: Base64): Uint8Array => Uint8Array.from(Buffer.from(s, 'base64'))

function keyPairToJson(k: IrKeyPair): IrKeyPairJson {
    return { pubKey: enc(k.pubKey), privKey: enc(k.privKey) }
}

function keyPairFromJson(j: IrKeyPairJson): IrKeyPair {
    return { pubKey: dec(j.pubKey), privKey: dec(j.privKey) }
}

function signedIdentityToJson(s: IrSignedIdentity): IrSignedIdentityJson {
    return {
        ...(s.details ? { details: enc(s.details) } : {}),
        ...(s.accountSignatureKey ? { accountSignatureKey: enc(s.accountSignatureKey) } : {}),
        ...(s.accountSignature ? { accountSignature: enc(s.accountSignature) } : {}),
        ...(s.deviceSignature ? { deviceSignature: enc(s.deviceSignature) } : {})
    }
}

function signedIdentityFromJson(j: IrSignedIdentityJson): IrSignedIdentity {
    return {
        ...(j.details ? { details: dec(j.details) } : {}),
        ...(j.accountSignatureKey ? { accountSignatureKey: dec(j.accountSignatureKey) } : {}),
        ...(j.accountSignature ? { accountSignature: dec(j.accountSignature) } : {}),
        ...(j.deviceSignature ? { deviceSignature: dec(j.deviceSignature) } : {})
    }
}

function identityToJson(id: IrIdentity): IrIdentityJson {
    return {
        noiseKeyPair: keyPairToJson(id.noiseKeyPair),
        signedIdentityKeyPair: keyPairToJson(id.signedIdentityKeyPair),
        registrationId: id.registrationId,
        advSecretKey: enc(id.advSecretKey),
        ...(id.signedIdentity ? { signedIdentity: signedIdentityToJson(id.signedIdentity) } : {}),
        ...(id.meJid !== undefined ? { meJid: id.meJid } : {}),
        ...(id.meLid !== undefined ? { meLid: id.meLid } : {}),
        ...(id.meDisplayName !== undefined ? { meDisplayName: id.meDisplayName } : {}),
        ...(id.platform !== undefined ? { platform: id.platform } : {}),
        ...(id.routingInfo ? { routingInfo: enc(id.routingInfo) } : {}),
        ...(id.accountSyncCounter !== undefined
            ? { accountSyncCounter: id.accountSyncCounter }
            : {}),
        ...(id.accountCreationTs !== undefined ? { accountCreationTs: id.accountCreationTs } : {})
    }
}

function identityFromJson(j: IrIdentityJson): IrIdentity {
    return {
        noiseKeyPair: keyPairFromJson(j.noiseKeyPair),
        signedIdentityKeyPair: keyPairFromJson(j.signedIdentityKeyPair),
        registrationId: j.registrationId,
        advSecretKey: dec(j.advSecretKey),
        ...(j.signedIdentity ? { signedIdentity: signedIdentityFromJson(j.signedIdentity) } : {}),
        ...(j.meJid !== undefined ? { meJid: j.meJid } : {}),
        ...(j.meLid !== undefined ? { meLid: j.meLid } : {}),
        ...(j.meDisplayName !== undefined ? { meDisplayName: j.meDisplayName } : {}),
        ...(j.platform !== undefined ? { platform: j.platform } : {}),
        ...(j.routingInfo ? { routingInfo: dec(j.routingInfo) } : {}),
        ...(j.accountSyncCounter !== undefined ? { accountSyncCounter: j.accountSyncCounter } : {}),
        ...(j.accountCreationTs !== undefined ? { accountCreationTs: j.accountCreationTs } : {})
    }
}

function signedPreKeyToJson(s: IrSignedPreKey): IrSignedPreKeyJson {
    return {
        keyId: s.keyId,
        keyPair: keyPairToJson(s.keyPair),
        signature: enc(s.signature),
        ...(s.timestampS !== undefined ? { timestampS: s.timestampS } : {}),
        ...(s.uploaded !== undefined ? { uploaded: s.uploaded } : {})
    }
}

function signedPreKeyFromJson(j: IrSignedPreKeyJson): IrSignedPreKey {
    return {
        keyId: j.keyId,
        keyPair: keyPairFromJson(j.keyPair),
        signature: dec(j.signature),
        ...(j.timestampS !== undefined ? { timestampS: j.timestampS } : {}),
        ...(j.uploaded !== undefined ? { uploaded: j.uploaded } : {})
    }
}

function preKeyToJson(p: IrPreKey): IrPreKeyJson {
    return {
        keyId: p.keyId,
        keyPair: keyPairToJson(p.keyPair),
        ...(p.uploaded !== undefined ? { uploaded: p.uploaded } : {})
    }
}

function preKeyFromJson(j: IrPreKeyJson): IrPreKey {
    return {
        keyId: j.keyId,
        keyPair: keyPairFromJson(j.keyPair),
        ...(j.uploaded !== undefined ? { uploaded: j.uploaded } : {})
    }
}

function sessionRecordToJson(r: IrSessionRecord): IrSessionRecordJson {
    return { proto: enc(r.proto) }
}

function sessionRecordFromJson(j: IrSessionRecordJson): IrSessionRecord {
    return { proto: dec(j.proto) }
}

function senderKeyRecordToJson(r: IrSenderKeyRecord): IrSenderKeyRecordJson {
    return { proto: enc(r.proto) }
}

function senderKeyRecordFromJson(j: IrSenderKeyRecordJson): IrSenderKeyRecord {
    return { proto: dec(j.proto) }
}

function appStateSyncKeyToJson(k: IrAppStateSyncKey): IrAppStateSyncKeyJson {
    return {
        keyId: enc(k.keyId),
        keyData: enc(k.keyData),
        ...(k.timestamp !== undefined ? { timestamp: k.timestamp } : {}),
        ...(k.fingerprint ? { fingerprint: k.fingerprint } : {})
    }
}

function appStateSyncKeyFromJson(j: IrAppStateSyncKeyJson): IrAppStateSyncKey {
    return {
        keyId: dec(j.keyId),
        keyData: dec(j.keyData),
        ...(j.timestamp !== undefined ? { timestamp: j.timestamp } : {}),
        ...(j.fingerprint ? { fingerprint: j.fingerprint } : {})
    }
}

function lthashToJson(v: IrLTHashState): IrLTHashStateJson {
    const indexValueMap: Array<[string, Base64]> = []
    for (const [k, val] of v.indexValueMap) indexValueMap.push([k, enc(val)])
    return {
        collection: v.collection,
        version: v.version,
        hash: enc(v.hash),
        indexValueMap
    }
}

function lthashFromJson(j: IrLTHashStateJson): IrLTHashState {
    const indexValueMap = new Map<string, Uint8Array>()
    for (const [k, val] of j.indexValueMap) indexValueMap.set(k, dec(val))
    return {
        collection: j.collection,
        version: j.version,
        hash: dec(j.hash),
        indexValueMap
    }
}

function privacyTokenToJson(p: IrPrivacyToken): IrPrivacyTokenJson {
    return {
        jid: p.jid,
        ...(p.token ? { token: enc(p.token) } : {}),
        ...(p.timestampMs !== undefined ? { timestampMs: p.timestampMs } : {}),
        ...(p.senderTimestampMs !== undefined ? { senderTimestampMs: p.senderTimestampMs } : {}),
        ...(p.nctSalt ? { nctSalt: enc(p.nctSalt) } : {})
    }
}

function privacyTokenFromJson(j: IrPrivacyTokenJson): IrPrivacyToken {
    return {
        jid: j.jid,
        ...(j.token ? { token: dec(j.token) } : {}),
        ...(j.timestampMs !== undefined ? { timestampMs: j.timestampMs } : {}),
        ...(j.senderTimestampMs !== undefined ? { senderTimestampMs: j.senderTimestampMs } : {}),
        ...(j.nctSalt ? { nctSalt: dec(j.nctSalt) } : {})
    }
}

function messageSecretToJson(m: IrMessageSecret): IrMessageSecretJson {
    return {
        messageId: m.messageId,
        senderJid: m.senderJid,
        ...(m.chatJid !== undefined ? { chatJid: m.chatJid } : {}),
        secret: enc(m.secret)
    }
}

function messageSecretFromJson(j: IrMessageSecretJson): IrMessageSecret {
    return {
        messageId: j.messageId,
        senderJid: j.senderJid,
        ...(j.chatJid !== undefined ? { chatJid: j.chatJid } : {}),
        secret: dec(j.secret)
    }
}

function senderKeyDistributionToJson(d: IrSenderKeyDistribution): IrSenderKeyDistributionJson {
    return { groupSender: d.groupSender, keyId: d.keyId, timestampMs: d.timestampMs }
}

function senderKeyDistributionFromJson(j: IrSenderKeyDistributionJson): IrSenderKeyDistribution {
    return { groupSender: j.groupSender, keyId: j.keyId, timestampMs: j.timestampMs }
}

export function snapshotToJson(snap: WaSnapshot): WaSnapshotJson {
    const preKeys: WaSnapshotJson['preKeys'] = []
    for (const [k, v] of snap.preKeys) preKeys.push([k, preKeyToJson(v)])

    const signalIdentities: WaSnapshotJson['signalIdentities'] = []
    for (const [k, v] of snap.signalIdentities) signalIdentities.push([k, enc(v)])

    const sessions: WaSnapshotJson['sessions'] = []
    for (const [k, v] of snap.sessions) {
        sessions.push([k, { address: v.address, record: sessionRecordToJson(v.record) }])
    }

    const senderKeys: WaSnapshotJson['senderKeys'] = []
    for (const [k, v] of snap.senderKeys) {
        senderKeys.push([
            k,
            { groupSender: v.groupSender, record: senderKeyRecordToJson(v.record) }
        ])
    }

    const senderKeyDistributions: WaSnapshotJson['senderKeyDistributions'] = []
    for (const [k, v] of snap.senderKeyDistributions) {
        senderKeyDistributions.push([k, senderKeyDistributionToJson(v)])
    }

    const appStateSyncKeys: WaSnapshotJson['appStateSyncKeys'] = []
    for (const [k, v] of snap.appStateSyncKeys) {
        appStateSyncKeys.push([k, appStateSyncKeyToJson(v)])
    }

    const appStateVersions: WaSnapshotJson['appStateVersions'] = []
    for (const [k, v] of snap.appStateVersions) appStateVersions.push([k, lthashToJson(v)])

    const privacyTokens: WaSnapshotJson['privacyTokens'] = []
    for (const [k, v] of snap.privacyTokens) privacyTokens.push([k, privacyTokenToJson(v)])

    const deviceLists: WaSnapshotJson['deviceLists'] = []
    for (const [k, v] of snap.deviceLists) deviceLists.push([k, v])

    const contacts: WaSnapshotJson['contacts'] = []
    for (const [k, v] of snap.contacts) contacts.push([k, v])

    const messageSecrets: WaSnapshotJson['messageSecrets'] = []
    for (const [k, v] of snap.messageSecrets) messageSecrets.push([k, messageSecretToJson(v)])

    return {
        schemaVersion: 1,
        source: snap.source,
        identity: identityToJson(snap.identity),
        signedPreKey: signedPreKeyToJson(snap.signedPreKey),
        preKeys,
        signalIdentities,
        sessions,
        senderKeys,
        senderKeyDistributions,
        appStateSyncKeys,
        appStateVersions,
        privacyTokens,
        deviceLists,
        contacts,
        messageSecrets
    }
}

export function snapshotFromJson(j: WaSnapshotJson): WaSnapshot {
    if (j.schemaVersion !== 1) {
        throw new Error(
            `unsupported WaSnapshotJson schemaVersion: ${(j as { schemaVersion: number }).schemaVersion}`
        )
    }
    const out: WaSnapshotMutable = emptySnapshot(
        j.source,
        identityFromJson(j.identity),
        signedPreKeyFromJson(j.signedPreKey)
    )
    for (const [k, v] of j.preKeys) out.preKeys.set(k, preKeyFromJson(v))
    for (const [k, v] of j.signalIdentities) out.signalIdentities.set(k, dec(v))
    for (const [k, v] of j.sessions) {
        out.sessions.set(k, { address: v.address, record: sessionRecordFromJson(v.record) })
    }
    for (const [k, v] of j.senderKeys) {
        out.senderKeys.set(k, {
            groupSender: v.groupSender,
            record: senderKeyRecordFromJson(v.record)
        })
    }
    for (const [k, v] of j.senderKeyDistributions) {
        out.senderKeyDistributions.set(k, senderKeyDistributionFromJson(v))
    }
    for (const [k, v] of j.appStateSyncKeys) {
        out.appStateSyncKeys.set(k, appStateSyncKeyFromJson(v))
    }
    for (const [k, v] of j.appStateVersions) out.appStateVersions.set(k, lthashFromJson(v))
    for (const [k, v] of j.privacyTokens) out.privacyTokens.set(k, privacyTokenFromJson(v))
    for (const [k, v] of j.deviceLists) out.deviceLists.set(k, v)
    for (const [k, v] of j.contacts) out.contacts.set(k, v)
    for (const [k, v] of j.messageSecrets) out.messageSecrets.set(k, messageSecretFromJson(v))
    return out
}
