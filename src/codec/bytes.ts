// Adapter inputs may carry bytes as `Uint8Array`, base64 string, or
// `{type:'Buffer',data:...}` JSON. The IR is strict `Uint8Array`.
export type MaybeBytes =
    | Uint8Array
    | string
    | { readonly type: 'Buffer'; readonly data: number[] | string }

export function asBytes(input: MaybeBytes, field: string): Uint8Array {
    if (input instanceof Uint8Array) return input
    if (typeof input === 'string') return fromBase64(input)
    if (input && typeof input === 'object' && (input as { type?: string }).type === 'Buffer') {
        const data = (input as { data: number[] | string }).data
        if (typeof data === 'string') return fromBase64(data)
        return Uint8Array.from(data)
    }
    throw new TypeError(
        `${field}: expected bytes-like (Uint8Array | base64 string | Buffer-JSON), got ${typeof input}`
    )
}

export function asOptionalBytes(
    input: MaybeBytes | null | undefined,
    field: string
): Uint8Array | undefined {
    if (input === null || input === undefined) return undefined
    return asBytes(input, field)
}

export function toBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64')
}

export function fromBase64(s: string): Uint8Array {
    return new Uint8Array(Buffer.from(s, 'base64'))
}

// libsignal Curve25519 pubkeys carry a `0x05` type prefix. Some serializers
// strip it — these helpers restore/strip on demand.
export function ensurePrefixed33(input: Uint8Array, field: string): Uint8Array {
    if (input.length === 33) return input
    if (input.length === 32) {
        const out = new Uint8Array(33)
        out[0] = 0x05
        out.set(input, 1)
        return out
    }
    throw new RangeError(`${field}: expected 32 or 33 bytes, got ${input.length}`)
}

export function stripPrefix33(input: Uint8Array, field: string): Uint8Array {
    if (input.length === 32) return input
    if (input.length === 33) {
        if (input[0] !== 0x05) throw new RangeError(`${field}: 33-byte key not prefixed with 0x05`)
        return input.subarray(1)
    }
    throw new RangeError(`${field}: expected 32 or 33 bytes, got ${input.length}`)
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false
    }
    return true
}
