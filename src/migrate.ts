import { ALL_DOMAINS, type IrDomain, type StoreAdapter } from '@adapter'
import { emptySnapshot, type WaSnapshot, type WaSnapshotMutable } from '@ir'
import { assertValidSnapshot } from '@ir/validate'

export interface LossReportEntry {
    readonly domain: IrDomain
    readonly severity: 'warn' | 'drop'
    readonly count: number
    readonly reason: string
}

export interface MigrateResult<TOut> {
    readonly data: TOut
    readonly snapshot: WaSnapshot
    readonly losses: readonly LossReportEntry[]
}

export interface MigrateArgs<TIn, TOut> {
    readonly from: StoreAdapter<TIn, unknown>
    readonly to: StoreAdapter<unknown, TOut>
    readonly data: TIn
    /** Run `assertValidSnapshot()` on the canonical snapshot. Off by default. */
    readonly validate?: boolean
    /**
     * Restrict the migration to a subset of domains. `identity` and
     * `signedPreKey` are scalars required by the snapshot shape and always
     * pass through, regardless of this list. Excluded domains are cleared
     * from the snapshot and omitted from the `losses` report.
     */
    readonly domains?: readonly IrDomain[]
}

const SCALAR_DOMAINS: ReadonlySet<IrDomain> = new Set(['identity', 'signedPreKey'])

function domainCount(snapshot: WaSnapshot, domain: IrDomain): number {
    if (SCALAR_DOMAINS.has(domain)) return 1
    const v = snapshot[domain as Exclude<IrDomain, 'identity' | 'signedPreKey'>]
    return v.size
}

function filterSnapshot(snapshot: WaSnapshot, keep: ReadonlySet<IrDomain>): WaSnapshot {
    const out: WaSnapshotMutable = emptySnapshot(
        snapshot.source,
        snapshot.identity,
        snapshot.signedPreKey
    )
    if (keep.has('preKeys')) for (const [k, v] of snapshot.preKeys) out.preKeys.set(k, v)
    if (keep.has('signalIdentities'))
        for (const [k, v] of snapshot.signalIdentities) out.signalIdentities.set(k, v)
    if (keep.has('sessions')) for (const [k, v] of snapshot.sessions) out.sessions.set(k, v)
    if (keep.has('senderKeys')) for (const [k, v] of snapshot.senderKeys) out.senderKeys.set(k, v)
    if (keep.has('senderKeyDistributions'))
        for (const [k, v] of snapshot.senderKeyDistributions) out.senderKeyDistributions.set(k, v)
    if (keep.has('appStateSyncKeys'))
        for (const [k, v] of snapshot.appStateSyncKeys) out.appStateSyncKeys.set(k, v)
    if (keep.has('appStateVersions'))
        for (const [k, v] of snapshot.appStateVersions) out.appStateVersions.set(k, v)
    if (keep.has('privacyTokens'))
        for (const [k, v] of snapshot.privacyTokens) out.privacyTokens.set(k, v)
    if (keep.has('deviceLists'))
        for (const [k, v] of snapshot.deviceLists) out.deviceLists.set(k, v)
    if (keep.has('contacts')) for (const [k, v] of snapshot.contacts) out.contacts.set(k, v)
    if (keep.has('messageSecrets'))
        for (const [k, v] of snapshot.messageSecrets) out.messageSecrets.set(k, v)
    return out
}

export function planLosses(
    from: StoreAdapter<unknown, unknown>,
    to: StoreAdapter<unknown, unknown>,
    snapshot: WaSnapshot
): readonly LossReportEntry[] {
    const losses: LossReportEntry[] = []
    for (const d of ALL_DOMAINS) {
        const count = domainCount(snapshot, d)
        if (count === 0) continue
        if (!to.capabilities.write.has(d)) {
            losses.push({
                domain: d,
                severity: 'drop',
                count,
                reason: `${to.id} adapter cannot write ${d}`
            })
            continue
        }
        if (from.capabilities.lossy?.has(d) || to.capabilities.lossy?.has(d)) {
            losses.push({
                domain: d,
                severity: 'warn',
                count,
                reason: `${d} round-trip is lossy between ${from.id} and ${to.id}`
            })
        }
    }
    return losses
}

export function migrate<TIn, TOut>(args: MigrateArgs<TIn, TOut>): MigrateResult<TOut> {
    const fullSnapshot = args.from.toCanonical(args.data)
    if (args.validate) assertValidSnapshot(fullSnapshot)
    const snapshot = args.domains
        ? filterSnapshot(
              fullSnapshot,
              new Set<IrDomain>([...args.domains, 'identity', 'signedPreKey'])
          )
        : fullSnapshot
    const losses = planLosses(args.from, args.to, snapshot)
    const data = args.to.fromCanonical(snapshot)
    return { data, snapshot, losses }
}
