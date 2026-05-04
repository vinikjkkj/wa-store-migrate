// libsignal-node `SessionRecord.serialize()` output shape (used by baileys).
// Bytes come as `Uint8Array` after `bufferJsonReviver` or as raw base64 strings.
export type MaybeSessionBytes = Uint8Array | string

export interface BaileysChainKey {
    readonly counter: number
    readonly key: MaybeSessionBytes
}

export type BaileysMessageKeys = Readonly<Record<string, MaybeSessionBytes>>

export interface BaileysChain {
    readonly chainKey: BaileysChainKey
    /** `1` = SENDING, `2` = RECEIVING (libsignal `chain_type.js`). */
    readonly chainType: number
    readonly messageKeys: BaileysMessageKeys
}

export interface BaileysCurrentRatchet {
    readonly ephemeralKeyPair: {
        readonly pubKey: MaybeSessionBytes
        readonly privKey: MaybeSessionBytes
    }
    readonly lastRemoteEphemeralKey: MaybeSessionBytes
    readonly previousCounter: number
    readonly rootKey: MaybeSessionBytes
}

export interface BaileysIndexInfo {
    readonly baseKey: MaybeSessionBytes
    /** `1` = OURS (Alice), `2` = THEIRS (Bob). */
    readonly baseKeyType: number
    /** `-1` when open, otherwise close timestamp. */
    readonly closed: number
    readonly used: number
    readonly created: number
    readonly remoteIdentityKey: MaybeSessionBytes
}

export interface BaileysPendingPreKey {
    readonly preKeyId?: number
    /** Note: baileys names this `signedKeyId` (not `signedPreKeyId`). */
    readonly signedKeyId: number
    readonly baseKey: MaybeSessionBytes
}

export interface BaileysSerializedSessionEntry {
    readonly registrationId: number
    readonly currentRatchet: BaileysCurrentRatchet
    readonly indexInfo: BaileysIndexInfo
    readonly _chains: Readonly<Record<string, BaileysChain>>
    readonly pendingPreKey?: BaileysPendingPreKey
}

export interface BaileysSerializedSessionRecord {
    readonly _sessions: Readonly<Record<string, BaileysSerializedSessionEntry>>
    /** Currently always `'v1'` in libsignal-node; widened for forward-compat. */
    readonly version: string
}

// `SenderKeyRecord.serialize()` returns `SenderKeyStateStructure[]`.
export interface BaileysSenderChainKey {
    readonly iteration: number
    readonly seed: MaybeSessionBytes
}

export interface BaileysSenderSigningKey {
    readonly public: MaybeSessionBytes
    readonly private?: MaybeSessionBytes
}

export interface BaileysSenderMessageKey {
    readonly iteration: number
    readonly seed: MaybeSessionBytes
}

export interface BaileysSenderKeyStateStructure {
    readonly senderKeyId: number
    readonly senderChainKey: BaileysSenderChainKey
    readonly senderSigningKey: BaileysSenderSigningKey
    readonly senderMessageKeys: readonly BaileysSenderMessageKey[]
}

export type BaileysSerializedSenderKey = readonly BaileysSenderKeyStateStructure[]
