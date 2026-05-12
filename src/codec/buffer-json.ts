// baileys multi-file auth-state shape: `{type:'Buffer', data:'<base64>'}` ↔ `Uint8Array`.
export function bufferJsonReviver(_key: string, value: unknown): unknown {
    if (value && typeof value === 'object' && (value as { type?: string }).type === 'Buffer') {
        const data = (value as { data?: unknown }).data
        if (typeof data === 'string') return new Uint8Array(Buffer.from(data, 'base64'))
        if (Array.isArray(data)) return Uint8Array.from(data as number[])
    }
    return value
}

export function bufferJsonReplacer(_key: string, value: unknown): unknown {
    if (value instanceof Uint8Array) {
        return { type: 'Buffer', data: Buffer.from(value).toString('base64') }
    }
    return value
}

function decodeBufferJsonLeaf(value: object): Uint8Array | null {
    const obj = value as { type?: unknown; data?: unknown }
    if (obj.type !== 'Buffer') return null
    if (typeof obj.data === 'string') return new Uint8Array(Buffer.from(obj.data, 'base64'))
    if (Array.isArray(obj.data)) return Uint8Array.from(obj.data as number[])
    return null
}

/** Convert `{type:'Buffer', data}` leaves to `Uint8Array` on an already-parsed object. */
export function coerceBufferJson<T>(value: T): T {
    if (value === null || typeof value !== 'object') return value
    if (value instanceof Uint8Array) return value
    if (Array.isArray(value)) {
        return value.map((v) => coerceBufferJson(v)) as unknown as T
    }
    const decoded = decodeBufferJsonLeaf(value)
    if (decoded !== null) return decoded as unknown as T
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value)) {
        out[k] = coerceBufferJson((value as Record<string, unknown>)[k])
    }
    return out as T
}

/** Inverse of `coerceBufferJson`: `Uint8Array` → `{type:'Buffer', data:'<base64>'}`. */
export function encodeBufferJson<T>(value: T): T {
    if (value === null || typeof value !== 'object') return value
    if (value instanceof Uint8Array) {
        return {
            type: 'Buffer',
            data: Buffer.from(value).toString('base64')
        } as unknown as T
    }
    if (Array.isArray(value)) {
        return value.map((v) => encodeBufferJson(v)) as unknown as T
    }
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value)) {
        out[k] = encodeBufferJson((value as Record<string, unknown>)[k])
    }
    return out as T
}

/** `Uint8Array` → raw base64 string (no Buffer-shape wrapper). For non-Node consumers (Go/Rust). */
export function encodeBytesAsBase64<T>(value: T): T {
    if (value === null || typeof value !== 'object') return value
    if (value instanceof Uint8Array) {
        return Buffer.from(value).toString('base64') as unknown as T
    }
    if (Array.isArray(value)) {
        return value.map((v) => encodeBytesAsBase64(v)) as unknown as T
    }
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value)) {
        out[k] = encodeBytesAsBase64((value as Record<string, unknown>)[k])
    }
    return out as T
}
