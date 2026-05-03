/**
 * Structural mirror of the data shapes from zapo's stores. The adapter does
 * not depend on `zapo-js` at runtime — the user reads from their stores into
 * this shape and writes from it back into their stores.
 *
 * Reference: `zapo-js/src/store/contracts/*.ts`, `zapo-js/src/auth/types.ts`,
 * `zapo-js/src/signal/types.ts`, `zapo-js/src/appstate/types.ts`.
 */

export interface ZapoKeyPair {
    readonly pubKey: Uint8Array
    readonly privKey: Uint8Array
}

export interface ZapoSignedPreKey {
    readonly keyId: number
    readonly keyPair: ZapoKeyPair
    readonly signature: Uint8Array
    readonly uploaded?: boolean
}

export interface ZapoRegistrationInfo {
    readonly registrationId: number
    readonly identityKeyPair: ZapoKeyPair
}

export interface ZapoSignedDeviceIdentity {
    readonly details?: Uint8Array | null
    readonly accountSignatureKey?: Uint8Array | null
    readonly accountSignature?: Uint8Array | null
    readonly deviceSignature?: Uint8Array | null
}

export interface ZapoAuthCredentials {
    readonly noiseKeyPair: ZapoKeyPair
    readonly registrationInfo: ZapoRegistrationInfo
    readonly signedPreKey: ZapoSignedPreKey
    readonly advSecretKey: Uint8Array
    readonly signedIdentity?: ZapoSignedDeviceIdentity
    readonly meJid?: string
    readonly meLid?: string
    readonly meDisplayName?: string
    readonly companionEncStatic?: Uint8Array
    readonly platform?: string
    readonly serverStaticKey?: Uint8Array
    readonly serverHasPreKeys?: boolean
    readonly routingInfo?: Uint8Array
    readonly lastSuccessTs?: number
    readonly accountCreationTs?: number
    readonly pushName?: string
}

export interface ZapoSignalAddress {
    readonly user: string
    readonly server?: string
    readonly device: number
}

export interface ZapoPreKeyRecord {
    readonly keyId: number
    readonly keyPair: ZapoKeyPair
    readonly uploaded?: boolean
}

export interface ZapoIdentity {
    readonly address: ZapoSignalAddress
    readonly identityKey: Uint8Array
}

export interface ZapoAppStateSyncKey {
    readonly keyId: Uint8Array
    readonly keyData: Uint8Array
    readonly timestamp: number
    readonly fingerprint?: {
        readonly rawId?: number
        readonly currentIndex?: number
        readonly deviceIndexes?: readonly number[]
    }
}

export interface ZapoAppStateCollectionVersion {
    readonly version: number
    readonly hash: Uint8Array
    readonly indexValueMap: Readonly<Record<string, Uint8Array>>
}

export interface ZapoAppStateData {
    readonly keys: readonly ZapoAppStateSyncKey[]
    readonly collections: Readonly<Record<string, ZapoAppStateCollectionVersion>>
}

export interface ZapoPrivacyToken {
    readonly jid: string
    readonly tcToken?: Uint8Array
    readonly tcTokenTimestamp?: number
    readonly tcTokenSenderTimestamp?: number
    readonly nctSalt?: Uint8Array
    readonly updatedAtMs: number
}

export interface ZapoDeviceListSnapshot {
    readonly userJid: string
    readonly deviceJids: readonly string[]
    readonly updatedAtMs: number
}

export interface ZapoContact {
    readonly jid: string
    readonly displayName?: string
    readonly pushName?: string
    readonly lid?: string
    readonly phoneNumber?: string
    readonly lastUpdatedMs: number
}

export interface ZapoMessageSecret {
    readonly messageId: string
    readonly senderJid: string
    readonly secret: Uint8Array
}

/**
 * Session/sender-key records as zapo-js's `WaSessionStore.setSession` and
 * `WaSenderKeyStore.upsertSenderKey` expect. The adapter translates these
 * into libsignal proto bytes (and back) using the helpers re-exported from
 * `zapo-js/signal` (`encodeSignalSessionRecord` / `decodeSignalSessionRecord`,
 * `encodeSenderKeyRecord` / `decodeSenderKeyRecord`).
 *
 * Imported from `zapo-js` at runtime — type-only here to avoid a hard dep
 * on internal types.
 */
export interface ZapoSessionEntry {
    readonly address: ZapoSignalAddress
    readonly record: unknown // SignalSessionRecord at runtime
}

export interface ZapoSenderKeyEntry {
    readonly groupId: string
    readonly sender: ZapoSignalAddress
    readonly record: unknown // SenderKeyRecord at runtime
}

export interface ZapoStoreSnapshot {
    readonly credentials: ZapoAuthCredentials
    readonly preKeys?: readonly ZapoPreKeyRecord[]
    readonly identities?: readonly ZapoIdentity[]
    readonly sessions?: readonly ZapoSessionEntry[]
    readonly senderKeys?: readonly ZapoSenderKeyEntry[]
    readonly appState?: ZapoAppStateData
    readonly privacyTokens?: readonly ZapoPrivacyToken[]
    readonly deviceLists?: readonly ZapoDeviceListSnapshot[]
    readonly contacts?: readonly ZapoContact[]
    readonly messageSecrets?: readonly ZapoMessageSecret[]
}
