/**
 * Structural types describing baileys' `AuthenticationState` shape after
 * `JSON.parse` with `bufferJsonReviver` (`{type:'Buffer',data:...}` already
 * turned into `Uint8Array`). The adapter does not depend on baileys at runtime.
 *
 * Reference: `baileys/src/Types/Auth.ts`.
 */
import type { BaileysSerializedSenderKey, BaileysSerializedSessionRecord } from './session-types.js'

export type BaileysSessionValue = BaileysSerializedSessionRecord | Uint8Array
export type BaileysSenderKeyValue = BaileysSerializedSenderKey | Uint8Array

export interface BaileysKeyPair {
    readonly public: Uint8Array
    readonly private: Uint8Array
}

export interface BaileysSignedKeyPair {
    readonly keyPair: BaileysKeyPair
    readonly signature: Uint8Array
    readonly keyId: number
    readonly timestampS?: number
}

export interface BaileysProtocolAddress {
    readonly name: string
    readonly deviceId: number
}

export interface BaileysSignalIdentity {
    readonly identifier: BaileysProtocolAddress
    readonly identifierKey: Uint8Array
}

export interface BaileysADVSignedDeviceIdentity {
    readonly details?: Uint8Array
    readonly accountSignatureKey?: Uint8Array
    readonly accountSignature?: Uint8Array
    readonly deviceSignature?: Uint8Array
}

export interface BaileysContact {
    readonly id: string
    readonly lid?: string
    readonly name?: string
    readonly notify?: string
    readonly verifiedName?: string
    readonly imgUrl?: string | null
    readonly status?: string
}

export interface BaileysAuthenticationCreds {
    readonly noiseKey: BaileysKeyPair
    readonly pairingEphemeralKeyPair: BaileysKeyPair
    readonly signedIdentityKey: BaileysKeyPair
    readonly signedPreKey: BaileysSignedKeyPair
    readonly registrationId: number
    /** base64-encoded 32-byte secret. */
    readonly advSecretKey: string
    readonly me?: BaileysContact
    readonly account?: BaileysADVSignedDeviceIdentity
    readonly signalIdentities?: readonly BaileysSignalIdentity[]
    readonly myAppStateKeyId?: string
    readonly firstUnuploadedPreKeyId: number
    readonly nextPreKeyId: number
    readonly lastAccountSyncTimestamp?: number
    readonly platform?: string
    readonly accountSyncCounter?: number
    readonly registered?: boolean
    readonly pairingCode?: string
    readonly lastPropHash?: string
    readonly routingInfo?: Uint8Array
}

export interface BaileysAppStateSyncKeyData {
    readonly keyData?: Uint8Array
    readonly fingerprint?: {
        readonly rawId?: number
        readonly currentIndex?: number
        readonly deviceIndexes?: readonly number[]
    }
    readonly timestamp?: number | string
}

export interface BaileysLTHashState {
    readonly version: number
    readonly hash: Uint8Array
    readonly indexValueMap: Readonly<Record<string, { readonly valueMac: Uint8Array }>>
}

export interface BaileysTcTokenEntry {
    readonly token: Uint8Array
    readonly timestamp?: string | number
}

/**
 * Mirrors `SignalDataSet` in baileys. `pre-key` carries the bare keypair (no
 * keyId — the dict key is the keyId), `app-state-sync-key` is the proto
 * payload.
 *
 * Note on `session` and `sender-key`: baileys' `SignalDataTypeMap` types both
 * as `Uint8Array`, but at runtime the values are libsignal-node's JS object
 * forms (`SessionRecord.serialize()` returns an object) or — for sender-key —
 * UTF-8 bytes of `JSON.stringify(record.serialize())`. The adapter accepts
 * either: the deserialized object (preferred when piping straight from a
 * SignalKeyStore implementation) or `Uint8Array` (raw stored bytes).
 */
export interface BaileysSignalDataSet {
    readonly 'pre-key'?: Readonly<Record<string, BaileysKeyPair | null>>
    readonly session?: Readonly<Record<string, BaileysSessionValue | null>>
    readonly 'sender-key'?: Readonly<Record<string, BaileysSenderKeyValue | null>>
    readonly 'sender-key-memory'?: Readonly<
        Record<string, Readonly<Record<string, boolean>> | null>
    >
    readonly 'app-state-sync-key'?: Readonly<Record<string, BaileysAppStateSyncKeyData | null>>
    readonly 'app-state-sync-version'?: Readonly<Record<string, BaileysLTHashState | null>>
    readonly 'lid-mapping'?: Readonly<Record<string, string | null>>
    readonly 'device-list'?: Readonly<Record<string, readonly string[] | null>>
    readonly tctoken?: Readonly<Record<string, BaileysTcTokenEntry | null>>
    readonly 'identity-key'?: Readonly<Record<string, Uint8Array | null>>
}

/**
 * What the user gives the adapter — equivalent to baileys' `AuthenticationState`
 * but as plain data. The user pulls `creds` from their auth-credentials store
 * and dumps every key family from their `SignalKeyStore` into `keys`.
 */
export interface BaileysAuthSnapshot {
    readonly creds: BaileysAuthenticationCreds
    readonly keys: BaileysSignalDataSet
}
