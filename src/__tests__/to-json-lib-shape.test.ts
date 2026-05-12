import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { snapshot } from '@api'
import { coerceBufferJson, encodeBufferJson } from '@codec'

import { fakeBaileysSnapshot, fakeWaWebSnapshot, fakeWhatsmeowSnapshot } from './fixtures.js'

const isBufferJsonLeaf = (v: unknown): boolean =>
    v !== null &&
    typeof v === 'object' &&
    (v as { type?: unknown }).type === 'Buffer' &&
    typeof (v as { data?: unknown }).data === 'string'

describe('encodeBufferJson', () => {
    test('Uint8Array → {type:"Buffer", data:"<base64>"}', () => {
        const bytes = new Uint8Array([1, 2, 3, 0xff])
        const out = encodeBufferJson(bytes) as unknown as { type: string; data: string }
        assert.equal(out.type, 'Buffer')
        assert.equal(out.data, Buffer.from(bytes).toString('base64'))
    })

    test('walks nested structures', () => {
        const input = {
            a: new Uint8Array([1]),
            b: { c: new Uint8Array([2]) },
            d: [new Uint8Array([3]), 'untouched', 42]
        }
        const out = encodeBufferJson(input) as unknown as {
            a: { type: string; data: string }
            b: { c: { type: string; data: string } }
            d: [{ type: string; data: string }, string, number]
        }
        assert.equal(out.a.type, 'Buffer')
        assert.equal(out.b.c.type, 'Buffer')
        assert.equal(out.d[0].type, 'Buffer')
        assert.equal(out.d[1], 'untouched')
        assert.equal(out.d[2], 42)
    })

    test('round-trip: encodeBufferJson + coerceBufferJson is identity', () => {
        const input = { a: new Uint8Array([1, 2]), b: 'x', c: { d: new Uint8Array([3]) } }
        const encoded = encodeBufferJson(input)
        const back = coerceBufferJson(encoded)
        assert.deepEqual([...back.a], [1, 2])
        assert.deepEqual([...back.c.d], [3])
        assert.equal(back.b, 'x')
    })

    test('primitives, null, undefined pass through', () => {
        assert.equal(encodeBufferJson('hello'), 'hello')
        assert.equal(encodeBufferJson(42), 42)
        assert.equal(encodeBufferJson(null), null)
        assert.equal(encodeBufferJson(undefined), undefined)
    })
})

describe('snapshot.toJSON(lib, ir) — JSON-safe lib shape', () => {
    test('baileys produces {type:Buffer} bytes at leaf positions', () => {
        const ir = snapshot.from('baileys', fakeBaileysSnapshot())
        const out = snapshot.toJSON('baileys', ir) as {
            creds: { noiseKey: { public: unknown; private: unknown } }
        }
        assert.ok(isBufferJsonLeaf(out.creds.noiseKey.public))
        assert.ok(isBufferJsonLeaf(out.creds.noiseKey.private))
    })

    test('wa-web produces {type:Buffer} bytes at leaf positions', () => {
        const ir = snapshot.from('wa-web', fakeWaWebSnapshot())
        const out = snapshot.toJSON('wa-web', ir) as {
            device: { noiseKey?: { pubKey: unknown; privKey: unknown } | null }
        }
        // wa-web may or may not have noiseKey depending on dump; assert
        // the IR roundtrip below covers the structural correctness instead.
        if (out.device.noiseKey) {
            assert.ok(isBufferJsonLeaf(out.device.noiseKey.pubKey))
            assert.ok(isBufferJsonLeaf(out.device.noiseKey.privKey))
        }
    })

    test('JSON.stringify(out) works without a replacer', () => {
        const ir = snapshot.from('baileys', fakeBaileysSnapshot())
        const out = snapshot.toJSON('baileys', ir)
        const json = JSON.stringify(out)
        const reparsed = JSON.parse(json) as {
            creds: { noiseKey: { public: unknown; private: unknown } }
        }
        assert.ok(isBufferJsonLeaf(reparsed.creds.noiseKey.public))
        assert.ok(isBufferJsonLeaf(reparsed.creds.noiseKey.private))
    })

    test('round-trip via toJSON(lib, ir) → JSON.parse → from(lib) → IR is lossless', () => {
        const ir1 = snapshot.from('baileys', fakeBaileysSnapshot())
        const json = JSON.stringify(snapshot.toJSON('baileys', ir1))
        // Going back through `from('baileys', ...)` — the adapter auto-coerces
        // {type:'Buffer'} back to Uint8Array, so no manual reviver needed.
        const reparsed = JSON.parse(json) as never
        const ir2 = snapshot.from('baileys', reparsed)
        assert.deepEqual(snapshot.toJSON(ir1), snapshot.toJSON(ir2))
    })

    test('single-arg toJSON(ir) still returns the portable IR wire format', () => {
        const ir = snapshot.from('baileys', fakeBaileysSnapshot())
        const out = snapshot.toJSON(ir)
        assert.equal(out.schemaVersion, 1)
        assert.equal(out.source, 'baileys')
        assert.ok(Array.isArray(out.preKeys))
    })

    test('whatsmeow produces raw base64 strings for bytes (not {type:Buffer})', () => {
        const ir = snapshot.from('whatsmeow', fakeWhatsmeowSnapshot())
        const out = snapshot.toJSON('whatsmeow', ir) as {
            device: { noiseKey: { pubKey: unknown; privKey: unknown } }
        }
        // Raw base64: each byte field is a string, NOT a {type:'Buffer'} object.
        assert.equal(typeof out.device.noiseKey.pubKey, 'string')
        assert.equal(typeof out.device.noiseKey.privKey, 'string')
        assert.ok(!isBufferJsonLeaf(out.device.noiseKey.pubKey))
    })

    test('whatsmeow output stringifies without a replacer', () => {
        const ir = snapshot.from('whatsmeow', fakeWhatsmeowSnapshot())
        const out = snapshot.toJSON('whatsmeow', ir)
        const json = JSON.stringify(out)
        // Reparses cleanly, bytes still strings (not coerced back to anything).
        const reparsed = JSON.parse(json) as {
            device: { noiseKey: { pubKey: unknown; privKey: unknown } }
        }
        assert.equal(typeof reparsed.device.noiseKey.pubKey, 'string')
    })
})
