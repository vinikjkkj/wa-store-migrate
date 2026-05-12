import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { baileysAdapter } from '@adapters/baileys'
import { coerceBufferJson } from '@codec'
import { snapshotToJson } from '@ir/json'

import { fakeBaileysSnapshot } from './fixtures.js'

const toBufferJson = (bytes: Uint8Array): unknown => ({
    type: 'Buffer',
    data: Buffer.from(bytes).toString('base64')
})

describe('coerceBufferJson', () => {
    test('converts {type:"Buffer", data: string} → Uint8Array', () => {
        const result = coerceBufferJson({
            type: 'Buffer',
            data: Buffer.from([1, 2, 3]).toString('base64')
        })
        assert.ok(result instanceof Uint8Array)
        assert.deepEqual([...result], [1, 2, 3])
    })

    test('converts {type:"Buffer", data: number[]} → Uint8Array (legacy shape)', () => {
        const result = coerceBufferJson({ type: 'Buffer', data: [1, 2, 3] })
        assert.ok(result instanceof Uint8Array)
        assert.deepEqual([...result], [1, 2, 3])
    })

    test('walks nested objects and arrays', () => {
        const input = {
            a: toBufferJson(new Uint8Array([1, 2])),
            b: { c: toBufferJson(new Uint8Array([3, 4])) },
            d: [toBufferJson(new Uint8Array([5, 6])), 'untouched']
        }
        const out = coerceBufferJson(input) as {
            a: Uint8Array
            b: { c: Uint8Array }
            d: [Uint8Array, string]
        }
        assert.ok(out.a instanceof Uint8Array)
        assert.deepEqual([...out.a], [1, 2])
        assert.deepEqual([...out.b.c], [3, 4])
        assert.deepEqual([...out.d[0]], [5, 6])
        assert.equal(out.d[1], 'untouched')
    })

    test('passes through Uint8Array, primitives, null, undefined', () => {
        const bytes = new Uint8Array([1, 2, 3])
        assert.equal(coerceBufferJson(bytes), bytes)
        assert.equal(coerceBufferJson('hello'), 'hello')
        assert.equal(coerceBufferJson(42), 42)
        assert.equal(coerceBufferJson(true), true)
        assert.equal(coerceBufferJson(null), null)
        assert.equal(coerceBufferJson(undefined), undefined)
    })

    test('ignores objects whose type is not literally "Buffer"', () => {
        const obj = { type: 'NotBuffer', data: 'abc' }
        const out = coerceBufferJson(obj)
        assert.deepEqual(out, { type: 'NotBuffer', data: 'abc' })
    })
})

describe('baileysAdapter auto-coerces buffer-json input', () => {
    test('Uint8Array input and {type:"Buffer"} input produce the same IR', () => {
        const clean = fakeBaileysSnapshot()
        // Stringify-then-parse-without-reviver simulates what a DB driver
        // does to a JSON column: bytes get serialized as {type:'Buffer'}
        // and then revived as plain objects.
        const bufferJsonShaped = JSON.parse(
            JSON.stringify(clean, (_k, v) =>
                v instanceof Uint8Array
                    ? { type: 'Buffer', data: Buffer.from(v).toString('base64') }
                    : v
            )
        )

        const fromClean = baileysAdapter.toCanonical(clean)
        const fromBufferJson = baileysAdapter.toCanonical(bufferJsonShaped)

        // Compare through the JSON wire form to normalize Buffer/Uint8Array
        // constructor differences (the matrix tests do the same trick).
        assert.deepEqual(snapshotToJson(fromClean), snapshotToJson(fromBufferJson))
    })

    test('mixed shapes work (some fields Uint8Array, some Buffer-json)', () => {
        const clean = fakeBaileysSnapshot()
        // Only flip creds.noiseKey through buffer-json shape; rest stays as bytes.
        const mixed = {
            ...clean,
            creds: {
                ...clean.creds,
                noiseKey: {
                    public: toBufferJson(clean.creds.noiseKey.public) as never,
                    private: toBufferJson(clean.creds.noiseKey.private) as never
                }
            }
        }

        const fromClean = baileysAdapter.toCanonical(clean)
        const fromMixed = baileysAdapter.toCanonical(mixed)
        assert.deepEqual(snapshotToJson(fromClean), snapshotToJson(fromMixed))
    })
})
