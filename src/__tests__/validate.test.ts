import assert from 'node:assert/strict'
import { test } from 'node:test'

import { baileysAdapter } from '@adapters/baileys'
import { zapoAdapter } from '@adapters/zapo'
import { SnapshotValidationError, validateSnapshot } from '@ir/validate'
import { migrate } from '@migrate'

import { fakeBaileysSnapshot, fakeZapoSnapshot } from './fixtures.js'

test('validateSnapshot accepts a clean baileys-sourced snapshot', () => {
    const snap = baileysAdapter.toCanonical(fakeBaileysSnapshot())
    assert.deepEqual(validateSnapshot(snap), [])
})

test('validateSnapshot reports wrong key sizes by path', () => {
    const snap = baileysAdapter.toCanonical(fakeBaileysSnapshot())
    const broken = {
        ...snap,
        identity: {
            ...snap.identity,
            advSecretKey: new Uint8Array(31) // truncated by one byte
        }
    }
    const issues = validateSnapshot(broken)
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.path, 'identity.advSecretKey')
    assert.match(issues[0]?.message ?? '', /32-byte payload, got 31/)
})

test('validateSnapshot flags preKey map keys mismatched with record keyId', () => {
    const snap = baileysAdapter.toCanonical(fakeBaileysSnapshot())
    const badPreKeys = new Map(snap.preKeys)
    const first = [...badPreKeys.values()][0]
    assert.ok(first)
    badPreKeys.set(99, { ...first, keyId: 1 })
    const issues = validateSnapshot({ ...snap, preKeys: badPreKeys })
    const issue = issues.find((i) => i.path === 'preKeys[99].keyId')
    assert.ok(issue, 'expected mismatched-keyId issue')
})

test('migrate({ validate: true }) throws SnapshotValidationError for bad input', () => {
    const data = fakeZapoSnapshot()
    const broken = {
        ...data,
        credentials: {
            ...data.credentials,
            advSecretKey: new Uint8Array(16) // way too short
        }
    }
    assert.throws(
        () => migrate({ from: zapoAdapter, to: baileysAdapter, data: broken, validate: true }),
        (err) => {
            assert.ok(err instanceof SnapshotValidationError)
            const issue = err.issues.find((i) => i.path === 'identity.advSecretKey')
            assert.ok(issue, 'advSecretKey issue should be reported')
            return true
        }
    )
})

test('migrate() without validate flag is permissive (does not throw on bad input)', () => {
    const data = fakeZapoSnapshot()
    const broken = {
        ...data,
        credentials: {
            ...data.credentials,
            advSecretKey: new Uint8Array(16)
        }
    }
    assert.doesNotThrow(() => migrate({ from: zapoAdapter, to: baileysAdapter, data: broken }))
})

test('validateSnapshot reports registrationId out of 14-bit range', () => {
    const snap = baileysAdapter.toCanonical(fakeBaileysSnapshot())
    for (const bad of [-1, 0x4000, 1.5]) {
        const issues = validateSnapshot({
            ...snap,
            identity: { ...snap.identity, registrationId: bad }
        })
        const issue = issues.find((i) => i.path === 'identity.registrationId')
        assert.ok(issue, `regId=${bad} should be flagged`)
    }
})

test('validateSnapshot reports wrong signedPreKey.signature size', () => {
    const snap = baileysAdapter.toCanonical(fakeBaileysSnapshot())
    const issues = validateSnapshot({
        ...snap,
        signedPreKey: { ...snap.signedPreKey, signature: new Uint8Array(60) }
    })
    const issue = issues.find((i) => i.path === 'signedPreKey.signature')
    assert.ok(issue)
    assert.match(issue.message, /64-byte payload, got 60/)
})

test('validateSnapshot rejects empty session proto bytes', () => {
    const snap = baileysAdapter.toCanonical(fakeBaileysSnapshot())
    const sessions = new Map(snap.sessions)
    const [firstKey, firstEntry] = [...sessions][0] ?? []
    assert.ok(firstKey && firstEntry)
    sessions.set(firstKey, { ...firstEntry, record: { proto: new Uint8Array(0) } })
    const issues = validateSnapshot({ ...snap, sessions })
    assert.ok(issues.some((i) => i.path.startsWith('sessions[') && /non-empty/.test(i.message)))
})
