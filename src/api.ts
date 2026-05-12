// `snapshot` namespace — the high-level entry point. Wraps adapter/registry
// lookups and IR serialization so callers don't import adapter objects or
// touch Map/Uint8Array plumbing directly.

import { ADAPTERS, type LibInput, type LibOutput } from '@adapters/registry'
import { buildSnapshot, type BuildSnapshotInit, type SnapshotBuilder } from '@ir/builder'
import { snapshotFromJson, snapshotToJson, type WaSnapshotJson } from '@ir/json'
import type { LibId, WaSnapshot } from '@ir/snapshot'

function from<L extends LibId>(lib: L, data: LibInput<L>): WaSnapshot {
    const adapter = ADAPTERS[lib] as unknown as {
        toCanonical: (d: LibInput<L>) => WaSnapshot
    }
    return adapter.toCanonical(data)
}

function to<L extends LibId>(lib: L, ir: WaSnapshot): LibOutput<L> {
    const adapter = ADAPTERS[lib] as unknown as {
        fromCanonical: (s: WaSnapshot) => LibOutput<L>
    }
    return adapter.fromCanonical(ir)
}

function build(init: BuildSnapshotInit): SnapshotBuilder {
    return buildSnapshot(init)
}

export const snapshot = {
    from,
    to,
    toJSON: snapshotToJson,
    fromJSON: snapshotFromJson,
    build
} as const

export type { WaSnapshotJson }
