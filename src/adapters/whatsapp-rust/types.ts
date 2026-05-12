/**
 * On-disk shape of `whatsapp-rust` (jlucaso/whatsapp-rust). Mirrors
 * `storages/sqlite-storage/src/schema.rs` + the `Device` struct in
 * `wacore/src/store/device.rs`.
 *
 * Sessions/sender-keys are raw libsignal `RecordStructure` proto bytes
 * (same wire format zapo emits) — no JSON wrapper layer like whatsmeow.
 * Address strings have rust's `<user>[:device]@<server>.0` form;
 * `c.us` is normalized to `s.whatsapp.net` by the IR.
 */

export interface WhatsappRustKeyPair {
    readonly pubKey: Uint8Array
    readonly privKey: Uint8Array
}

export interface WhatsappRustServerCertChain {
    readonly bytes: Uint8Array
}

export interface WhatsappRustDevice {
    readonly registrationId: number
    readonly noiseKey: WhatsappRustKeyPair
    readonly identityKey: WhatsappRustKeyPair
    readonly signedPreKey: WhatsappRustKeyPair
    readonly signedPreKeyId: number
    readonly signedPreKeySignature: Uint8Array
    readonly advSecretKey: Uint8Array
    /** Encoded `AdvSignedDeviceIdentity` proto bytes. */
    readonly account?: Uint8Array
    readonly pn?: string
    readonly lid?: string
    readonly pushName?: string
    readonly appVersionPrimary?: number
    readonly appVersionSecondary?: number
    readonly appVersionTertiary?: number
    readonly appVersionLastFetchedMs?: number
    readonly edgeRoutingInfo?: Uint8Array
    readonly propsHash?: string
    readonly nextPreKeyId?: number
    readonly serverHasPrekeys?: boolean
    readonly nctSalt?: Uint8Array
    readonly serverCertChain?: WhatsappRustServerCertChain
}

export interface WhatsappRustPreKeyRow {
    readonly keyId: number
    readonly keyPair: WhatsappRustKeyPair
    readonly uploaded: boolean
}

export interface WhatsappRustIdentityRow {
    readonly address: string
    readonly key: Uint8Array
}

export interface WhatsappRustSessionRow {
    readonly address: string
    readonly record: Uint8Array
}

export interface WhatsappRustSenderKeyRow {
    readonly address: string
    readonly record: Uint8Array
}

/**
 * Rust's `sender_key_devices` table — pairs each bare sender-key record with
 * the device JIDs that share it, so device-keyed libs can recover the per-
 * device entries on round-trip.
 */
export interface WhatsappRustSenderKeyDeviceRow {
    readonly groupJid: string
    readonly deviceJid: string
    readonly hasKey: boolean
}

export interface WhatsappRustAppStateKey {
    readonly keyId: Uint8Array
    readonly keyData: Uint8Array
}

/**
 * `stateData` is `bincode::serde::encode(&HashState, standard())`.
 * `app_state_mutation_macs` is the authoritative source of `indexValueMap`
 * — rust never populates `HashState.index_value_map` itself.
 */
export interface WhatsappRustAppStateVersionRow {
    readonly name: string
    readonly stateData: Uint8Array
}

export interface WhatsappRustAppStateMutationMacRow {
    readonly name: string
    readonly version: number
    readonly indexMac: Uint8Array
    readonly valueMac: Uint8Array
}

export interface WhatsappRustTcTokenRow {
    readonly jid: string
    readonly token: Uint8Array
    readonly tokenTimestamp: number
    readonly senderTimestamp?: number
}

export interface WhatsappRustDeviceRegistryRow {
    readonly userJid: string
    readonly devicesJson: string
    readonly timestamp: number
    readonly phash?: string
    readonly rawId?: number
}

export interface WhatsappRustLidPnMappingRow {
    readonly lid: string
    readonly phoneNumber: string
    readonly createdAt: number
    readonly learningSource: string
    readonly updatedAt: number
}

export interface WhatsappRustSnapshot {
    readonly device: WhatsappRustDevice
    readonly preKeys?: readonly WhatsappRustPreKeyRow[]
    readonly identities?: readonly WhatsappRustIdentityRow[]
    readonly sessions?: readonly WhatsappRustSessionRow[]
    readonly senderKeys?: readonly WhatsappRustSenderKeyRow[]
    readonly senderKeyDevices?: readonly WhatsappRustSenderKeyDeviceRow[]
    readonly appStateKeys?: readonly WhatsappRustAppStateKey[]
    readonly appStateVersions?: readonly WhatsappRustAppStateVersionRow[]
    readonly appStateMutationMacs?: readonly WhatsappRustAppStateMutationMacRow[]
    readonly tcTokens?: readonly WhatsappRustTcTokenRow[]
    readonly deviceRegistry?: readonly WhatsappRustDeviceRegistryRow[]
    readonly lidPnMapping?: readonly WhatsappRustLidPnMappingRow[]
}
