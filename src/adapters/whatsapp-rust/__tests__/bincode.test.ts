import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
    decodeRustHashState,
    encodeRustHashState,
    readBincodeVarint,
    writeBincodeVarint
} from '@adapters/whatsapp-rust/bincode'

function encodeOne(v: number): Uint8Array {
    const out: number[] = []
    writeBincodeVarint(v, out)
    return new Uint8Array(out)
}

describe('bincode varint encoding (whatsapp-rust standard config)', () => {
    test('values 0..250 encode as a single byte', () => {
        for (const v of [0, 1, 14, 100, 250]) {
            assert.deepEqual([...encodeOne(v)], [v])
        }
    })

    test('251..u16::MAX encode as marker 251 + 2 LE bytes', () => {
        // 251 itself overflows the small-byte range
        assert.deepEqual([...encodeOne(251)], [251, 251, 0])
        assert.deepEqual([...encodeOne(0xffff)], [251, 0xff, 0xff])
        // mid-range
        assert.deepEqual([...encodeOne(1234)], [251, 1234 & 0xff, (1234 >> 8) & 0xff])
    })

    test('u16::MAX+1..u32::MAX encode as marker 252 + 4 LE bytes', () => {
        const v = 0x12345678
        assert.deepEqual([...encodeOne(v)], [252, 0x78, 0x56, 0x34, 0x12])
    })

    test('round-trip varint through encode→decode', () => {
        for (const v of [0, 1, 250, 251, 65535, 65536, 0xfffffff, 0x12345678]) {
            const enc = encodeOne(v)
            const dec = readBincodeVarint(enc, 0)
            assert.ok(dec, `failed to decode varint for ${v}`)
            assert.equal(dec.value, v)
            assert.equal(dec.next, enc.length)
        }
    })

    test('truncated varint returns null', () => {
        // marker says u16 follows but we cut after the marker
        assert.equal(readBincodeVarint(new Uint8Array([251]), 0), null)
        assert.equal(readBincodeVarint(new Uint8Array([252, 1, 2]), 0), null)
    })
})

describe('encodeRustHashState / decodeRustHashState', () => {
    function makeHash(b: number): Uint8Array {
        return new Uint8Array(128).fill(b)
    }

    test('round-trips an empty-map state', () => {
        const enc = encodeRustHashState({ version: 14, hash: makeHash(0xab) })
        const dec = decodeRustHashState(enc)
        assert.ok(dec)
        assert.equal(dec.version, 14)
        assert.deepEqual(dec.hash, makeHash(0xab))
        assert.equal(dec.indexValueMap.size, 0)
    })

    test('produces the expected wire layout for a small empty-map state', () => {
        const enc = encodeRustHashState({ version: 14, hash: makeHash(0x00) })
        // 1 byte version + 128 bytes hash + 1 byte empty-map count = 130
        assert.equal(enc.length, 130)
        assert.equal(enc[0], 14)
        for (let i = 1; i <= 128; i += 1) assert.equal(enc[i], 0)
        assert.equal(enc[129], 0) // empty map count
    })

    test('round-trips a populated map', () => {
        const indexValueMap = new Map<string, Uint8Array>([
            ['alpha', new Uint8Array([1, 2, 3])],
            ['beta', new Uint8Array(64).fill(0xcc)]
        ])
        const enc = encodeRustHashState({ version: 0xffff, hash: makeHash(0x55), indexValueMap })
        const dec = decodeRustHashState(enc)
        assert.ok(dec)
        assert.equal(dec.version, 0xffff)
        assert.deepEqual(dec.hash, makeHash(0x55))
        assert.equal(dec.indexValueMap.size, 2)
        assert.deepEqual(dec.indexValueMap.get('alpha'), new Uint8Array([1, 2, 3]))
        assert.deepEqual(dec.indexValueMap.get('beta'), new Uint8Array(64).fill(0xcc))
    })

    test('rejects hash that is not 128 bytes', () => {
        assert.throws(() => encodeRustHashState({ version: 1, hash: new Uint8Array(64) }))
    })

    test('decoder returns null on truncated input (smaller than version+hash)', () => {
        assert.equal(decodeRustHashState(new Uint8Array(0)), null)
        assert.equal(decodeRustHashState(new Uint8Array([14, 1, 2, 3])), null)
    })

    test('decoder returns null when an entry length runs past the buffer', () => {
        // version=0, hash=128 zeros, map has 1 entry, key claims length 99 but we provide 0 bytes
        const buf = new Uint8Array(1 + 128 + 1 + 1)
        buf[0] = 0 // version varint
        buf[1 + 128] = 1 // map_len varint = 1
        buf[1 + 128 + 1] = 99 // key_len varint = 99 (intentionally exceeds remaining)
        assert.equal(decodeRustHashState(buf), null)
    })

    test('round-trips a u64-sized version through marker 253', () => {
        // > 0xFFFFFFFF forces the BigInt branch in writeBincodeVarint.
        const big = 0x1_0000_0000
        const enc = encodeRustHashState({
            version: big,
            hash: new Uint8Array(128).fill(0xab)
        })
        // marker 253 + 8 LE bytes + 128 hash + 1 empty-map count = 138
        assert.equal(enc.length, 138)
        assert.equal(enc[0], 253)
        const dec = decodeRustHashState(enc)
        assert.ok(dec)
        assert.equal(dec.version, big)
    })
})
