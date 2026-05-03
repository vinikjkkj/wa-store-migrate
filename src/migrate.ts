import { ALL_DOMAINS, type IrDomain, type StoreAdapter } from '@adapter'
import type { WaSnapshot } from '@ir'
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
    /**
     * When true, run `assertValidSnapshot()` on the canonical snapshot before
     * handing it to the destination adapter. Off by default — turn on while
     * iterating on a new adapter or when migrating untrusted data.
     */
    readonly validate?: boolean
}

const SCALAR_DOMAINS: ReadonlySet<IrDomain> = new Set(['identity', 'signedPreKey'])

function domainCount(snapshot: WaSnapshot, domain: IrDomain): number {
    if (SCALAR_DOMAINS.has(domain)) return 1
    const v = snapshot[domain as Exclude<IrDomain, 'identity' | 'signedPreKey'>]
    return v.size
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
    const snapshot = args.from.toCanonical(args.data)
    if (args.validate) assertValidSnapshot(snapshot)
    const losses = planLosses(args.from, args.to, snapshot)
    const data = args.to.fromCanonical(snapshot)
    return { data, snapshot, losses }
}
