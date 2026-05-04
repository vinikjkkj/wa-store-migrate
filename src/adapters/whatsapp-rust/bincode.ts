/**
 * bincode 2.x codec for `wacore_appstate::hash::HashState`.
 *
 * `bincode::config::standard()` = little-endian + variable-length integers:
 *   - 0..=250 : the byte itself
 *   - 251     : marker, then 2 LE bytes (u16)
 *   - 252     : marker, then 4 LE bytes (u32)
 *   - 253     : marker, then 8 LE bytes (u64)
 *   - 254     : marker, then 16 LE bytes (u128)
 *
 * `HashState` layout:
 *   varint(version) + 128 raw bytes(hash) + varint(map_len) + entries
 *   each entry: varint(key_len) + utf8(key) + varint(val_len) + bytes(val)
 *
 * rust's `update_hash` writer never populates `index_value_map` —
 * mutation MACs ride in the separate `app_state_mutation_macs` table.
 */

export function writeBincodeVarint(value: number, out: number[]): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`bincode varint: expected non-negative finite number, got ${value}`)
    }
    if (value <= 250) {
        out.push(value)
        return
    }
    if (value <= 0xffff) {
        out.push(251, value & 0xff, (value >>> 8) & 0xff)
        return
    }
    if (value <= 0xffffffff) {
        out.push(
            252,
            value & 0xff,
            (value >>> 8) & 0xff,
            (value >>> 16) & 0xff,
            (value >>> 24) & 0xff
        )
        return
    }
    out.push(253)
    let v = BigInt(value)
    for (let i = 0; i < 8; i += 1) {
        out.push(Number(v & 0xffn))
        v >>= 8n
    }
}

export interface BincodeReadResult {
    readonly value: number
    readonly next: number
}

export function readBincodeVarint(bytes: Uint8Array, p: number): BincodeReadResult | null {
    if (p >= bytes.length) return null
    const b = bytes[p]!
    if (b <= 250) return { value: b, next: p + 1 }
    if (b === 251) {
        if (p + 3 > bytes.length) return null
        const v = bytes[p + 1]! | (bytes[p + 2]! << 8)
        return { value: v, next: p + 3 }
    }
    if (b === 252) {
        if (p + 5 > bytes.length) return null
        // `<<` returns a signed int32; `>>> 0` re-casts to unsigned.
        const v =
            (bytes[p + 1]! |
                (bytes[p + 2]! << 8) |
                (bytes[p + 3]! << 16) |
                (bytes[p + 4]! << 24)) >>>
            0
        return { value: v, next: p + 5 }
    }
    if (b === 253) {
        if (p + 9 > bytes.length) return null
        let v = 0n
        for (let i = 0; i < 8; i += 1) v |= BigInt(bytes[p + 1 + i]!) << BigInt(i * 8)
        return { value: Number(v), next: p + 9 }
    }
    return null
}

const HASH_LEN = 128

export interface RustHashState {
    readonly version: number
    readonly hash: Uint8Array
    readonly indexValueMap: ReadonlyMap<string, Uint8Array>
}

export function encodeRustHashState(state: {
    readonly version: number
    readonly hash: Uint8Array
    readonly indexValueMap?: ReadonlyMap<string, Uint8Array>
}): Uint8Array {
    if (state.hash.length !== HASH_LEN) {
        throw new RangeError(`HashState.hash must be ${HASH_LEN} bytes, got ${state.hash.length}`)
    }
    const out: number[] = []
    writeBincodeVarint(state.version, out)
    for (let i = 0; i < HASH_LEN; i += 1) out.push(state.hash[i]!)
    const map = state.indexValueMap ?? new Map<string, Uint8Array>()
    writeBincodeVarint(map.size, out)
    for (const [k, v] of map) {
        const kBytes = Buffer.from(k, 'utf-8')
        writeBincodeVarint(kBytes.length, out)
        for (let i = 0; i < kBytes.length; i += 1) out.push(kBytes[i]!)
        writeBincodeVarint(v.length, out)
        for (let i = 0; i < v.length; i += 1) out.push(v[i]!)
    }
    return new Uint8Array(out)
}

export function decodeRustHashState(bytes: Uint8Array): RustHashState | null {
    let p = 0
    const v0 = readBincodeVarint(bytes, p)
    if (!v0) return null
    p = v0.next
    if (p + HASH_LEN > bytes.length) return null
    const hash = bytes.slice(p, p + HASH_LEN)
    p += HASH_LEN
    const m0 = readBincodeVarint(bytes, p)
    if (!m0) return null
    p = m0.next
    const indexValueMap = new Map<string, Uint8Array>()
    for (let i = 0; i < m0.value; i += 1) {
        const kLen = readBincodeVarint(bytes, p)
        if (!kLen) return null
        p = kLen.next
        if (p + kLen.value > bytes.length) return null
        const key = Buffer.from(bytes.slice(p, p + kLen.value)).toString('utf-8')
        p += kLen.value
        const vLen = readBincodeVarint(bytes, p)
        if (!vLen) return null
        p = vLen.next
        if (p + vLen.value > bytes.length) return null
        const val = bytes.slice(p, p + vLen.value)
        p += vLen.value
        indexValueMap.set(key, val)
    }
    return { version: v0.value, hash, indexValueMap }
}
