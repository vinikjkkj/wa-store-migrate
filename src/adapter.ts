import type { LibId, WaSnapshot } from './ir/index.js'

export type IrDomain =
    | 'identity'
    | 'signedPreKey'
    | 'preKeys'
    | 'signalIdentities'
    | 'sessions'
    | 'senderKeys'
    | 'senderKeyDistributions'
    | 'appStateSyncKeys'
    | 'appStateVersions'
    | 'privacyTokens'
    | 'deviceLists'
    | 'contacts'
    | 'messageSecrets'

export type DomainCapabilities = ReadonlySet<IrDomain>

export interface AdapterCapabilities {
    readonly read: DomainCapabilities
    readonly write: DomainCapabilities
    /** Domains exposed with reduced fidelity — surfaced as `warn` in LossReport. */
    readonly lossy?: DomainCapabilities
}

// Pure-function contract — adapters never do I/O. The caller is responsible
// for reading from / writing to the actual stores.
export interface StoreAdapter<TIn, TOut = TIn> {
    readonly id: LibId
    readonly capabilities: AdapterCapabilities
    toCanonical(input: TIn): WaSnapshot
    fromCanonical(snapshot: WaSnapshot): TOut
}

export const ALL_DOMAINS: readonly IrDomain[] = [
    'identity',
    'signedPreKey',
    'preKeys',
    'signalIdentities',
    'sessions',
    'senderKeys',
    'senderKeyDistributions',
    'appStateSyncKeys',
    'appStateVersions',
    'privacyTokens',
    'deviceLists',
    'contacts',
    'messageSecrets'
]
