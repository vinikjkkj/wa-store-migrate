import type { IrAddress, IrGroupSender } from './address.js'
import type { IrSenderKeyRecord, IrSessionRecord } from './session.js'

export type LibId = 'zapo' | 'baileys' | 'whatsmeow' | 'wa-web'

export interface IrKeyPair {
    readonly pubKey: Uint8Array
    readonly privKey: Uint8Array
}

export interface IrSignedPreKey {
    readonly keyId: number
    readonly keyPair: IrKeyPair
    readonly signature: Uint8Array
    readonly timestampS?: number
    readonly uploaded?: boolean
}

export interface IrPreKey {
    readonly keyId: number
    readonly keyPair: IrKeyPair
    readonly uploaded?: boolean
}

/**
 * ADV signed-device identity payload (proto.ADVSignedDeviceIdentity bytes,
 * not decoded). All four fields are produced together by the primary device
 * during pairing and required to re-authenticate.
 */
export interface IrSignedIdentity {
    readonly details?: Uint8Array
    readonly accountSignatureKey?: Uint8Array
    readonly accountSignature?: Uint8Array
    readonly deviceSignature?: Uint8Array
}

export interface IrIdentity {
    readonly noiseKeyPair: IrKeyPair
    readonly signedIdentityKeyPair: IrKeyPair
    readonly registrationId: number
    /** 32-byte ADV master secret (raw bytes, not base64). */
    readonly advSecretKey: Uint8Array
    readonly signedIdentity?: IrSignedIdentity
    readonly meJid?: string
    readonly meLid?: string
    readonly meDisplayName?: string
    readonly platform?: string
    readonly routingInfo?: Uint8Array
    readonly accountSyncCounter?: number
    readonly accountCreationTs?: number
}

export interface IrSenderKeyDistribution {
    readonly groupSender: IrGroupSender
    readonly keyId: number
    readonly timestampMs: number
}

export interface IrAppStateSyncKey {
    readonly keyId: Uint8Array
    readonly keyData: Uint8Array
    readonly timestamp?: number
    readonly fingerprint?: {
        readonly rawId?: number
        readonly currentIndex?: number
        readonly deviceIndexes?: readonly number[]
    }
}

export interface IrLTHashState {
    readonly collection: string
    readonly version: number
    readonly hash: Uint8Array
    readonly indexValueMap: ReadonlyMap<string, Uint8Array>
}

export interface IrPrivacyToken {
    readonly jid: string
    readonly token?: Uint8Array
    readonly timestampMs?: number
    readonly senderTimestampMs?: number
    readonly nctSalt?: Uint8Array
}

export interface IrDeviceList {
    readonly userJid: string
    readonly deviceJids: readonly string[]
    readonly updatedAtMs: number
}

export interface IrContact {
    readonly jid: string
    readonly displayName?: string
    readonly pushName?: string
    readonly verifiedName?: string
    readonly lid?: string
    readonly phoneNumber?: string
    readonly lastUpdatedMs?: number
}

export interface IrMessageSecret {
    readonly messageId: string
    readonly senderJid: string
    /** Group-scoped messages have a separate chat JID; in 1-on-1 it equals `senderJid`. Optional — zapo does not retain it. */
    readonly chatJid?: string
    readonly secret: Uint8Array
}

/**
 * Bytes-keyed maps round-trip cleanly only with `string` keys, so binary keys
 * are pre-encoded as their natural string form (libsignal address string for
 * sessions, base64 for keyId-by-bytes maps).
 */
export interface WaSnapshot {
    readonly schemaVersion: 1
    readonly source: LibId
    readonly identity: IrIdentity
    readonly signedPreKey: IrSignedPreKey
    readonly preKeys: ReadonlyMap<number, IrPreKey>
    readonly signalIdentities: ReadonlyMap<string, Uint8Array>
    readonly sessions: ReadonlyMap<
        string,
        { readonly address: IrAddress; readonly record: IrSessionRecord }
    >
    readonly senderKeys: ReadonlyMap<
        string,
        { readonly groupSender: IrGroupSender; readonly record: IrSenderKeyRecord }
    >
    readonly senderKeyDistributions: ReadonlyMap<string, IrSenderKeyDistribution>
    readonly appStateSyncKeys: ReadonlyMap<string, IrAppStateSyncKey>
    readonly appStateVersions: ReadonlyMap<string, IrLTHashState>
    readonly privacyTokens: ReadonlyMap<string, IrPrivacyToken>
    readonly deviceLists: ReadonlyMap<string, IrDeviceList>
    readonly contacts: ReadonlyMap<string, IrContact>
    readonly messageSecrets: ReadonlyMap<string, IrMessageSecret>
}

export type WaSnapshotMutable = {
    -readonly [K in keyof WaSnapshot]: WaSnapshot[K] extends ReadonlyMap<infer K2, infer V>
        ? Map<K2, V>
        : WaSnapshot[K]
}

export function emptySnapshot(
    source: LibId,
    identity: IrIdentity,
    signedPreKey: IrSignedPreKey
): WaSnapshotMutable {
    return {
        schemaVersion: 1,
        source,
        identity,
        signedPreKey,
        preKeys: new Map(),
        signalIdentities: new Map(),
        sessions: new Map(),
        senderKeys: new Map(),
        senderKeyDistributions: new Map(),
        appStateSyncKeys: new Map(),
        appStateVersions: new Map(),
        privacyTokens: new Map(),
        deviceLists: new Map(),
        contacts: new Map(),
        messageSecrets: new Map()
    }
}
