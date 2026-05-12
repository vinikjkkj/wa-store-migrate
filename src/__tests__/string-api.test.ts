import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { baileysAdapter } from '@adapters/baileys'
import { ADAPTERS } from '@adapters/registry'
import { zapoAdapter } from '@adapters/zapo'
import { migrate, planLosses } from '@migrate'

import { fakeBaileysSnapshot } from './fixtures.js'

describe('migrate() accepts LibId strings', () => {
    test('strings on both sides produce same result as adapter objects', () => {
        const data = fakeBaileysSnapshot()
        const viaStrings = migrate({ from: 'baileys', to: 'zapo', data })
        const viaAdapters = migrate({ from: baileysAdapter, to: zapoAdapter, data })
        assert.deepEqual(viaStrings.snapshot, viaAdapters.snapshot)
        assert.deepEqual(viaStrings.losses, viaAdapters.losses)
    })

    test('mixed string + adapter works', () => {
        const data = fakeBaileysSnapshot()
        const result = migrate({ from: 'baileys', to: zapoAdapter, data })
        assert.equal(result.snapshot.source, 'baileys')
    })

    test('planLosses() accepts strings', () => {
        const data = fakeBaileysSnapshot()
        const { snapshot } = migrate({ from: 'baileys', to: 'zapo', data })
        const lossesByString = planLosses('baileys', 'zapo', snapshot)
        const lossesByAdapter = planLosses(baileysAdapter, zapoAdapter, snapshot)
        assert.deepEqual(lossesByString, lossesByAdapter)
    })

    test('ADAPTERS registry exposes all 5 libs', () => {
        assert.deepEqual(Object.keys(ADAPTERS).sort(), [
            'baileys',
            'wa-web',
            'whatsapp-rust',
            'whatsmeow',
            'zapo'
        ])
        assert.equal(ADAPTERS.baileys.id, 'baileys')
        assert.equal(ADAPTERS.zapo.id, 'zapo')
    })
})
