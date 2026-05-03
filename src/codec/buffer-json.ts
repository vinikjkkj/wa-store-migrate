/**
 * Reviver matching baileys' multi-file auth state format. Use with
 * `JSON.parse(text, bufferJsonReviver)` to turn `{ type: 'Buffer', data: '<base64>' }`
 * objects back into `Uint8Array`. Idempotent if the value is already bytes.
 */
export function bufferJsonReviver(_key: string, value: unknown): unknown {
    if (value && typeof value === 'object' && (value as { type?: string }).type === 'Buffer') {
        const data = (value as { data?: unknown }).data
        if (typeof data === 'string') return new Uint8Array(Buffer.from(data, 'base64'))
        if (Array.isArray(data)) return Uint8Array.from(data as number[])
    }
    return value
}

/**
 * Replacer matching baileys' multi-file auth state output: encodes
 * `Uint8Array`/`Buffer` as `{ type: 'Buffer', data: '<base64>' }`.
 */
export function bufferJsonReplacer(_key: string, value: unknown): unknown {
    if (value instanceof Uint8Array) {
        return { type: 'Buffer', data: Buffer.from(value).toString('base64') }
    }
    return value
}
