// JSON dump shape for `wa-web` IndexedDB stores. The user produces this in a
// logged-in `web.whatsapp.com` tab via the snippet in `examples/wa-web-dump.js`.
// Validated against `wa-web/WAWebSignalStorage/*` + `WAWebSignalProtocolStore/*`.

export interface WaWebKeyPair {
    readonly pubKey: Uint8Array
    readonly privKey: Uint8Array
}

export interface WaWebSignalDeviceRow {
    readonly noiseKey: WaWebKeyPair
    readonly identityKey: WaWebKeyPair
    readonly signedPreKey: {
        readonly keyId: number
        readonly keyPair: WaWebKeyPair
        readonly signature: Uint8Array
    }
    readonly registrationId: number
    readonly advSecretKey: Uint8Array
    readonly account?: {
        readonly details?: Uint8Array
        readonly accountSignatureKey?: Uint8Array
        readonly accountSignature?: Uint8Array
        readonly deviceSignature?: Uint8Array
    }
    readonly meJid?: string
    readonly meLid?: string
    readonly platform?: string
}

export interface WaWebPreKeyRow {
    readonly keyId: number
    readonly keyPair: WaWebKeyPair
    readonly uploaded?: boolean
}

export interface WaWebIdentityRow {
    readonly jid: string
    readonly device: number
    readonly identityKey: Uint8Array
}

// wa-web persists sessions/sender-keys as decoded structured objects.
// The adapter accepts both that shape and pre-encoded proto bytes.
export interface WaWebSessionRow {
    readonly jid: string
    readonly device: number
    readonly session: Uint8Array | Record<string, unknown>
}

export interface WaWebSenderKeyRow {
    readonly groupId: string
    readonly senderJid: string
    readonly senderDevice: number
    readonly record: Uint8Array | { senderKeyStates: readonly unknown[] }
}

export interface WaWebAppStateSyncKeyRow {
    readonly keyId: Uint8Array
    readonly keyData: Uint8Array
    readonly timestamp: number
}

export interface WaWebAppStateVersionRow {
    readonly collection: string
    readonly version: number
    readonly hash: Uint8Array
    readonly indexValueMap: Readonly<Record<string, Uint8Array>>
}

export interface WaWebPrivacyTokenRow {
    readonly jid: string
    readonly token: Uint8Array
    readonly timestampMs: number
}

export interface WaWebDeviceListRow {
    readonly userJid: string
    /** Numeric device ids; the adapter combines them with `userJid` for IR. */
    readonly deviceIds: readonly number[]
    readonly timestampMs: number
}

export interface WaWebMessageSecretRow {
    readonly messageId: string
    readonly senderJid: string
    readonly chatJid?: string
    readonly secret: Uint8Array
}

export interface WaWebContactRow {
    readonly jid: string
    readonly displayName?: string
    readonly pushName?: string
    readonly verifiedName?: string
    readonly lid?: string
    readonly phoneNumber?: string
}

export interface WaWebSnapshot {
    readonly device: WaWebSignalDeviceRow
    readonly preKeys?: readonly WaWebPreKeyRow[]
    readonly identities?: readonly WaWebIdentityRow[]
    readonly sessions?: readonly WaWebSessionRow[]
    readonly senderKeys?: readonly WaWebSenderKeyRow[]
    readonly appStateSyncKeys?: readonly WaWebAppStateSyncKeyRow[]
    readonly appStateVersions?: readonly WaWebAppStateVersionRow[]
    readonly privacyTokens?: readonly WaWebPrivacyTokenRow[]
    readonly contacts?: readonly WaWebContactRow[]
    readonly deviceLists?: readonly WaWebDeviceListRow[]
    readonly messageSecrets?: readonly WaWebMessageSecretRow[]
}
