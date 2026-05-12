import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { baileysAdapter } from '@adapters/baileys'
import { zapoAdapter } from '@adapters/zapo'
import { snapshot } from '@api'
import type { WaSnapshot } from '@ir'
import { snapshotFromJson, snapshotToJson } from '@ir/json'

import {
    fakeBaileysSnapshot,
    fakeWaWebSnapshot,
    fakeWhatsappRustSnapshot,
    fakeWhatsmeowSnapshot,
    fakeZapoSnapshot
} from './fixtures.js'

const SOURCES = [
    { id: 'baileys' as const, ir: () => baileysAdapter.toCanonical(fakeBaileysSnapshot()) },
    { id: 'zapo' as const, ir: () => zapoAdapter.toCanonical(fakeZapoSnapshot()) }
]

// Adapters may produce a mix of `Buffer` and `Uint8Array` in the IR (each
// source lib hands its own). node:assert/strict.deepEqual distinguishes those
// constructors even when bytes match, so we canonicalize through the JSON
// form (where both become base64 strings) before comparing.
function deepEqualSnapshot(a: WaSnapshot, b: WaSnapshot): void {
    assert.deepEqual(snapshotToJson(a), snapshotToJson(b))
}

describe('snapshotToJson / snapshotFromJson', () => {
    for (const src of SOURCES) {
        test(`${src.id} → IR → JSON → IR is lossless`, () => {
            const ir = src.ir()
            const json = snapshotToJson(ir)
            const back = snapshotFromJson(json)
            deepEqualSnapshot(ir, back)
        })

        test(`${src.id} JSON is JSON.stringify-able (no Map, no Uint8Array)`, () => {
            const ir = src.ir()
            const json = snapshotToJson(ir)
            const text = JSON.stringify(json)
            const parsed = JSON.parse(text) as typeof json
            const back = snapshotFromJson(parsed)
            deepEqualSnapshot(ir, back)
        })
    }

    test('all 5 libs produce valid JSON via snapshot.from + snapshot.toJSON', () => {
        const cases = [
            { lib: 'baileys' as const, data: fakeBaileysSnapshot() },
            { lib: 'zapo' as const, data: fakeZapoSnapshot() },
            { lib: 'whatsmeow' as const, data: fakeWhatsmeowSnapshot() },
            { lib: 'wa-web' as const, data: fakeWaWebSnapshot() },
            { lib: 'whatsapp-rust' as const, data: fakeWhatsappRustSnapshot() }
        ]
        for (const c of cases) {
            const ir = snapshot.from(c.lib, c.data)
            const json = snapshot.toJSON(ir)
            assert.equal(json.schemaVersion, 1)
            assert.equal(json.source, c.lib)
            // round-trip back through JSON.stringify
            const text = JSON.stringify(json)
            const back = snapshot.fromJSON(JSON.parse(text) as typeof json)
            assert.equal(back.source, c.lib)
        }
    })

    test('schemaVersion mismatch throws', () => {
        const ir = baileysAdapter.toCanonical(fakeBaileysSnapshot())
        const json = snapshotToJson(ir) as { schemaVersion: number }
        json.schemaVersion = 99
        assert.throws(() => snapshotFromJson(json as never), /schemaVersion/)
    })

    test('JSON shape: Maps are arrays of [key, value] pairs', () => {
        const ir = baileysAdapter.toCanonical(fakeBaileysSnapshot())
        const json = snapshotToJson(ir)
        assert.ok(Array.isArray(json.preKeys), 'preKeys should be array')
        assert.ok(Array.isArray(json.sessions), 'sessions should be array')
        if (json.preKeys.length > 0) {
            assert.ok(Array.isArray(json.preKeys[0]), 'preKeys entry should be [k,v] tuple')
            assert.equal(json.preKeys[0].length, 2)
        }
    })

    test('JSON shape: bytes are base64 strings', () => {
        const ir = baileysAdapter.toCanonical(fakeBaileysSnapshot())
        const json = snapshotToJson(ir)
        assert.equal(typeof json.identity.advSecretKey, 'string')
        assert.equal(typeof json.identity.noiseKeyPair.pubKey, 'string')
        assert.equal(typeof json.signedPreKey.signature, 'string')
    })
})
