import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { normalizeWaJid, normalizeWaServer, parseLibsignalAddress } from '@codec/address'

describe('parseLibsignalAddress error paths', () => {
    test('throws when no `:`/`.` separator is present', () => {
        assert.throws(() => parseLibsignalAddress('5511999999999@s.whatsapp.net'), SyntaxError)
    })

    test('throws on non-numeric device suffix', () => {
        assert.throws(() => parseLibsignalAddress('5511999999999@s.whatsapp.net:abc'), SyntaxError)
    })

    test('throws on negative device', () => {
        assert.throws(() => parseLibsignalAddress('5511999999999@s.whatsapp.net:-1'), SyntaxError)
    })

    test('throws on unknown server', () => {
        assert.throws(() => parseLibsignalAddress('5511999999999@evil.example:0'), /unknown server/)
    })

    test('throws on non-numeric agent', () => {
        assert.throws(() => parseLibsignalAddress('5511999999999_xx@s.whatsapp.net:0'), /bad agent/)
    })
})

describe('parseLibsignalAddress accepted forms', () => {
    test('colon and dot device separators agree', () => {
        const a = parseLibsignalAddress('5511999999999@s.whatsapp.net:2')
        const b = parseLibsignalAddress('5511999999999@s.whatsapp.net.2')
        assert.deepEqual(a, b)
    })

    test('c.us is normalized to s.whatsapp.net', () => {
        const a = parseLibsignalAddress('5511999999999@c.us:0')
        assert.equal(a.server, 's.whatsapp.net')
    })

    test('preserves agent suffix', () => {
        const a = parseLibsignalAddress('5511999999999_3:1')
        assert.equal(a.user, '5511999999999')
        assert.equal(a.agent, 3)
        assert.equal(a.device, 1)
    })
})

describe('normalize helpers', () => {
    test('normalizeWaServer returns null for unknown', () => {
        assert.equal(normalizeWaServer('weird.us'), null)
    })

    test('normalizeWaJid leaves unknown servers alone', () => {
        assert.equal(normalizeWaJid('id@something.else'), 'id@something.else')
    })

    test('normalizeWaJid leaves bare ids (no @) alone', () => {
        assert.equal(normalizeWaJid('justuser'), 'justuser')
    })
})
