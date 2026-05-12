// `snapshot` namespace — the high-level entry point. Wraps adapter/registry
// lookups and IR serialization so callers don't import adapter objects or
// touch Map/Uint8Array plumbing directly.

import { ADAPTERS, type LibInput, type LibOutput } from '@adapters/registry'
import { encodeBufferJson, encodeBytesAsBase64 } from '@codec/buffer-json'
import { buildSnapshot, type BuildSnapshotInit, type SnapshotBuilder } from '@ir/builder'
import { snapshotFromJson, snapshotToJson, type WaSnapshotJson } from '@ir/json'
import type { LibId, WaSnapshot } from '@ir/snapshot'

/** Libs with a canonical JSON persistence form. */
export type JsonSerializableLib = 'baileys' | 'wa-web' | 'whatsmeow' | 'whatsapp-rust'

const BUFFER_JSON_LIBS = new Set<JsonSerializableLib>(['baileys', 'wa-web'])

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

// toJSON: lib-agnostic IR wire format, or lib-specific JSON shape.
function toJSON(ir: WaSnapshot): WaSnapshotJson
function toJSON<L extends JsonSerializableLib>(lib: L, ir: WaSnapshot): LibOutput<L>
function toJSON(
    arg1: WaSnapshot | JsonSerializableLib,
    arg2?: WaSnapshot
): WaSnapshotJson | LibOutput<JsonSerializableLib> {
    if (typeof arg1 === 'string') {
        const libOut = to(arg1, arg2 as WaSnapshot)
        return BUFFER_JSON_LIBS.has(arg1) ? encodeBufferJson(libOut) : encodeBytesAsBase64(libOut)
    }
    return snapshotToJson(arg1)
}

export const snapshot = {
    from,
    to,
    toJSON,
    fromJSON: snapshotFromJson,
    build
} as const

export type { WaSnapshotJson }
