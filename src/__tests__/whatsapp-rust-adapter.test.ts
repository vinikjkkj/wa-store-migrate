import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { whatsappRustAdapter, type WhatsappRustSnapshot } from '@adapters/whatsapp-rust'

import { fakeWhatsappRustSnapshot } from './fixtures.js'

describe('whatsapp-rust adapter edge cases', () => {
    test('garbage account bytes are silently ignored (no signedIdentity in IR)', () => {
        const base = fakeWhatsappRustSnapshot()
        const broken: WhatsappRustSnapshot = {
            ...base,
            device: { ...base.device, account: new Uint8Array([0xff, 0xff, 0xff, 0xff]) }
        }
        const snap = whatsappRustAdapter.toCanonical(broken)
        assert.equal(snap.identity.signedIdentity, undefined)
    })

    test('malformed sender-key address (no @) is skipped, not thrown', () => {
        const base = fakeWhatsappRustSnapshot()
        const broken: WhatsappRustSnapshot = {
            ...base,
            senderKeys: [
                ...(base.senderKeys ?? []),
                { address: 'no-at-sign-here.0', record: new Uint8Array([1, 2, 3]) }
            ]
        }
        const snap = whatsappRustAdapter.toCanonical(broken)
        assert.equal(snap.senderKeys.size, base.senderKeys?.length ?? 0)
    })

    test('malformed devicesJson row leaves deviceJids empty', () => {
        const base = fakeWhatsappRustSnapshot()
        const broken: WhatsappRustSnapshot = {
            ...base,
            deviceRegistry: [
                {
                    userJid: '5511444444444@s.whatsapp.net',
                    devicesJson: '{not valid json',
                    timestamp: 1700000000
                }
            ]
        }
        const snap = whatsappRustAdapter.toCanonical(broken)
        const dl = snap.deviceLists.get('5511444444444@s.whatsapp.net')
        assert.ok(dl)
        assert.deepEqual([...dl.deviceJids], [])
    })
})
