import type { LibId, WaSnapshot } from './ir/index.js'

/**
 * What the adapter can read or write. Used by `migrate()` to compute losses
 * before running a conversion.
 *
 * Each domain is one entry in the snapshot. `read` = adapter can produce it
 * from this lib's data; `write` = adapter can persist it back into this lib's
 * data. A direction is lossy when `from.read[d]` is false but the snapshot
 * carries data, or `to.write[d]` is false.
 */
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
    /**
     * Domains the adapter exposes but with reduced fidelity (e.g. baileys
     * sessions drop skipped message keys). Surfaced in LossReport as warnings.
     */
    readonly lossy?: DomainCapabilities
}

/**
 * Pure-function adapter contract: no I/O, no async unless the lib's data
 * shape itself requires it. Adapters never read files or talk to stores —
 * the user is responsible for getting their data in/out.
 */
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
