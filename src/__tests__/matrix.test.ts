import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { StoreAdapter } from '@adapter'
import { baileysAdapter } from '@adapters/baileys'
import { waWebAdapter } from '@adapters/wa-web'
import { whatsappRustAdapter } from '@adapters/whatsapp-rust'
import { whatsmeowAdapter } from '@adapters/whatsmeow'
import { zapoAdapter } from '@adapters/zapo'
import { validateSnapshot } from '@ir/validate'
import { migrate } from '@migrate'

import {
    fakeBaileysSnapshot,
    fakeWaWebSnapshot,
    fakeWhatsappRustSnapshot,
    fakeWhatsmeowSnapshot,
    fakeZapoSnapshot,
    SAMPLE_REGID,
    SAMPLE_USER_JID
} from './fixtures.js'

interface LibCase<T> {
    readonly id: 'baileys' | 'zapo' | 'whatsmeow' | 'wa-web' | 'whatsapp-rust'
    readonly adapter: StoreAdapter<T, T>
    readonly fixture: () => T
}

const LIBS: ReadonlyArray<LibCase<unknown>> = [
    { id: 'baileys', adapter: baileysAdapter, fixture: fakeBaileysSnapshot },
    { id: 'zapo', adapter: zapoAdapter, fixture: fakeZapoSnapshot },
    { id: 'whatsmeow', adapter: whatsmeowAdapter, fixture: fakeWhatsmeowSnapshot },
    { id: 'wa-web', adapter: waWebAdapter, fixture: fakeWaWebSnapshot },
    { id: 'whatsapp-rust', adapter: whatsappRustAdapter, fixture: fakeWhatsappRustSnapshot }
]

// Domains that adapters cannot write — drops here are expected and the test
// should not fail on them. Sourced from the adapter `capabilities.write` set.
const KNOWN_NON_WRITABLE: Readonly<Record<string, ReadonlySet<string>>> = {
    baileys: new Set(['contacts', 'messageSecrets']),
    'wa-web': new Set(),
    whatsmeow: new Set(['deviceLists']),
    zapo: new Set(),
    'whatsapp-rust': new Set(['contacts', 'messageSecrets'])
}

describe('all 12 cross-direction routes', () => {
    for (const from of LIBS) {
        for (const to of LIBS) {
            if (from.id === to.id) continue
            test(`${from.id} -> ${to.id}: identity, signedPreKey, preKeys survive`, () => {
                const data = from.fixture()
                const {
                    data: out,
                    snapshot,
                    losses
                } = migrate({
                    from: from.adapter,
                    to: to.adapter,
                    data,
                    validate: true
                })

                assert.equal(snapshot.source, from.id)

                // identity invariants
                assert.equal(snapshot.identity.registrationId, SAMPLE_REGID)
                assert.equal(snapshot.identity.advSecretKey.length, 32)
                assert.equal(snapshot.identity.noiseKeyPair.privKey.length, 32)
                assert.ok([32, 33].includes(snapshot.identity.signedIdentityKeyPair.pubKey.length))

                if (snapshot.identity.meJid) {
                    assert.equal(snapshot.identity.meJid, SAMPLE_USER_JID)
                }

                // signed pre-key invariants
                assert.equal(snapshot.signedPreKey.keyId, 1)
                assert.equal(snapshot.signedPreKey.signature.length, 64)

                // preKeys survive when both ends support them
                if (
                    from.adapter.capabilities.read.has('preKeys') &&
                    to.adapter.capabilities.write.has('preKeys')
                ) {
                    assert.ok(snapshot.preKeys.size > 0, `${from.id}->${to.id}: preKeys empty`)
                }

                // Drops are only acceptable when the target genuinely cannot write the domain.
                const expectedDrops = KNOWN_NON_WRITABLE[to.id] ?? new Set()
                for (const d of losses.filter((l) => l.severity === 'drop')) {
                    if (!expectedDrops.has(d.domain)) {
                        assert.fail(
                            `unexpected drop on ${from.id}->${to.id}: ${d.domain} (${d.count})`
                        )
                    }
                }

                // sanity: out is a valid object
                assert.equal(typeof out, 'object')
                assert.ok(out !== null)
            })
        }
    }
})

describe('round-trip stability per lib', () => {
    for (const lib of LIBS) {
        test(`${lib.id} -> IR -> ${lib.id} preserves identity + signedPreKey`, () => {
            const original = lib.fixture()
            const snap1 = lib.adapter.toCanonical(original)
            const back = lib.adapter.fromCanonical(snap1)
            const snap2 = lib.adapter.toCanonical(back)

            assert.equal(snap2.identity.registrationId, snap1.identity.registrationId)
            assert.deepEqual(snap2.identity.advSecretKey, snap1.identity.advSecretKey)
            assert.deepEqual(snap2.identity.noiseKeyPair.pubKey, snap1.identity.noiseKeyPair.pubKey)
            assert.deepEqual(
                snap2.identity.noiseKeyPair.privKey,
                snap1.identity.noiseKeyPair.privKey
            )
            assert.equal(snap2.signedPreKey.keyId, snap1.signedPreKey.keyId)
            assert.deepEqual(snap2.signedPreKey.signature, snap1.signedPreKey.signature)
            assert.equal(snap2.preKeys.size, snap1.preKeys.size)
        })
    }
})

describe('domains filter', () => {
    test('domains: ["preKeys"] keeps only preKeys + the two scalars', () => {
        const {
            data: out,
            snapshot,
            losses
        } = migrate({
            from: baileysAdapter,
            to: zapoAdapter,
            data: fakeBaileysSnapshot(),
            domains: ['preKeys']
        })

        // identity + signedPreKey are always preserved.
        assert.equal(snapshot.identity.registrationId, SAMPLE_REGID)
        assert.equal(snapshot.signedPreKey.keyId, 1)
        assert.ok(snapshot.preKeys.size > 0, 'preKeys should pass through')

        // Every other domain map is empty.
        assert.equal(snapshot.signalIdentities.size, 0)
        assert.equal(snapshot.sessions.size, 0)
        assert.equal(snapshot.senderKeys.size, 0)
        assert.equal(snapshot.appStateSyncKeys.size, 0)
        assert.equal(snapshot.appStateVersions.size, 0)
        assert.equal(snapshot.privacyTokens.size, 0)
        assert.equal(snapshot.deviceLists.size, 0)
        assert.equal(snapshot.contacts.size, 0)
        assert.equal(snapshot.messageSecrets.size, 0)

        // No losses for excluded domains — they were intentionally dropped.
        for (const l of losses) {
            assert.ok(
                ['preKeys', 'identity', 'signedPreKey'].includes(l.domain),
                `unexpected loss for excluded domain "${l.domain}"`
            )
        }

        // Output is a real ZapoStoreSnapshot — just sanity-check it's an object.
        assert.equal(typeof out, 'object')
        assert.ok(out !== null)
    })

    test('domains: ["sessions"] excludes preKeys but keeps sessions intact', () => {
        const data = fakeBaileysSnapshot()
        const baseline = migrate({ from: baileysAdapter, to: zapoAdapter, data })
        const filtered = migrate({
            from: baileysAdapter,
            to: zapoAdapter,
            data,
            domains: ['sessions']
        })

        assert.ok(baseline.snapshot.sessions.size > 0, 'fixture provides at least one session')
        assert.equal(
            filtered.snapshot.sessions.size,
            baseline.snapshot.sessions.size,
            'sessions should pass through unchanged'
        )
        assert.equal(filtered.snapshot.preKeys.size, 0, 'preKeys should be excluded')
        assert.equal(filtered.snapshot.signalIdentities.size, 0)
    })

    test('omitting domains migrates everything (default behavior)', () => {
        const baseline = migrate({
            from: baileysAdapter,
            to: zapoAdapter,
            data: fakeBaileysSnapshot()
        })
        // Whatever the fixture provides should be present.
        assert.ok(baseline.snapshot.preKeys.size > 0)
        assert.ok(baseline.snapshot.sessions.size > 0)
    })
})

describe('snapshot validation', () => {
    for (const lib of LIBS) {
        test(`${lib.id} fixture passes validateSnapshot()`, () => {
            const snap = lib.adapter.toCanonical(lib.fixture())
            const issues = validateSnapshot(snap)
            assert.deepEqual(
                issues,
                [],
                `${lib.id}: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`
            )
        })
    }
})
