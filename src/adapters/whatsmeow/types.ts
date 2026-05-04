// Dump shape for whatsmeow's `store.Device` (the user produces this from Go).
// Sessions/sender-keys carry the UTF-8 bytes of `go.mau.fi/libsignal`'s JSON
// serialization — see [./go-libsignal-codec.ts](./go-libsignal-codec.ts).
export interface WhatsmeowKeyPair {
    readonly pubKey: Uint8Array
    readonly privKey: Uint8Array
}

export interface WhatsmeowDeviceRow {
    readonly noiseKey: WhatsmeowKeyPair
    readonly identityKey: WhatsmeowKeyPair
    readonly signedPreKey: {
        readonly keyId: number
        readonly keyPair: WhatsmeowKeyPair
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
    readonly platform?: string
    readonly businessName?: string
    readonly pushName?: string
    readonly meJid?: string
    readonly meLid?: string
    readonly facebookUuid?: string
    readonly initialized?: boolean
}

export interface WhatsmeowPreKeyRow {
    readonly keyId: number
    readonly keyPair: WhatsmeowKeyPair
    readonly uploaded: boolean
}

export interface WhatsmeowIdentityKeyRow {
    /** `<user>:<device>` libsignal address. */
    readonly addr: string
    readonly identityKey: Uint8Array
}

export interface WhatsmeowSessionRow {
    readonly addr: string
    readonly session: Uint8Array
}

export interface WhatsmeowSenderKeyRow {
    readonly groupId: string
    readonly senderAddr: string
    readonly record: Uint8Array
}

export interface WhatsmeowAppStateSyncKeyRow {
    readonly keyId: Uint8Array
    readonly keyData: Uint8Array
    readonly timestamp: number
    readonly fingerprint: Uint8Array
}

export interface WhatsmeowAppStateVersionRow {
    readonly collection: string
    readonly version: number
    readonly hash: Uint8Array
}

export interface WhatsmeowAppStateMutationMacRow {
    readonly collection: string
    readonly version: number
    readonly indexMac: Uint8Array
    readonly valueMac: Uint8Array
}

export interface WhatsmeowContactRow {
    readonly jid: string
    readonly firstName?: string
    readonly fullName?: string
    readonly pushName?: string
    readonly businessName?: string
}

export interface WhatsmeowPrivacyTokenRow {
    readonly userJid: string
    readonly token: Uint8Array
    readonly timestampS: number
}

export interface WhatsmeowMessageSecretRow {
    readonly chatJid: string
    readonly senderJid: string
    readonly messageId: string
    readonly key: Uint8Array
}

export interface WhatsmeowLidMappingRow {
    readonly lid: string
    readonly pn: string
}

export interface WhatsmeowSnapshot {
    readonly device: WhatsmeowDeviceRow
    readonly preKeys?: readonly WhatsmeowPreKeyRow[]
    readonly identities?: readonly WhatsmeowIdentityKeyRow[]
    readonly sessions?: readonly WhatsmeowSessionRow[]
    readonly senderKeys?: readonly WhatsmeowSenderKeyRow[]
    readonly appStateSyncKeys?: readonly WhatsmeowAppStateSyncKeyRow[]
    readonly appStateVersions?: readonly WhatsmeowAppStateVersionRow[]
    readonly appStateMutationMacs?: readonly WhatsmeowAppStateMutationMacRow[]
    readonly contacts?: readonly WhatsmeowContactRow[]
    readonly privacyTokens?: readonly WhatsmeowPrivacyTokenRow[]
    readonly messageSecrets?: readonly WhatsmeowMessageSecretRow[]
    readonly lidMappings?: readonly WhatsmeowLidMappingRow[]
}
