export type { AdapterCapabilities, DomainCapabilities, IrDomain, StoreAdapter } from '@adapter'
export { ALL_DOMAINS } from '@adapter'

export type {
    IrAddress,
    IrAppStateSyncKey,
    IrContact,
    IrDeviceList,
    IrGroupSender,
    IrIdentity,
    IrKeyPair,
    IrLTHashState,
    IrMessageSecret,
    IrPreKey,
    IrPrivacyToken,
    IrSenderKeyDistribution,
    IrSenderKeyRecord,
    IrSessionRecord,
    IrSignedIdentity,
    IrSignedPreKey,
    LibId,
    WaSnapshot,
    WaSnapshotMutable
} from '@ir'
export {
    SnapshotValidationError,
    assertValidSnapshot,
    emptySnapshot,
    irAddressKey,
    irGroupSenderKey,
    validateSnapshot
} from '@ir'
export type { ValidationIssue } from '@ir'

export type {
    AdapterRef,
    LossReportEntry,
    MigrateArgs,
    MigrateArgsByLib,
    MigrateResult
} from '@migrate'
export { migrate, planLosses } from '@migrate'

export type { LibInput, LibOutput, LibShapeMap } from '@adapters/registry'
export { ADAPTERS } from '@adapters/registry'

export {
    asBytes,
    asOptionalBytes,
    bufferJsonReplacer,
    bufferJsonReviver,
    bytesEqual,
    ensurePrefixed33,
    fromBase64,
    parseLibsignalAddress,
    stripPrefix33,
    toBase64,
    toLibsignalAddress
} from '@codec'

export { baileysAdapter } from '@adapters/baileys'
export { zapoAdapter } from '@adapters/zapo'
export { whatsmeowAdapter } from '@adapters/whatsmeow'
export { waWebAdapter } from '@adapters/wa-web'
export { whatsappRustAdapter } from '@adapters/whatsapp-rust'
