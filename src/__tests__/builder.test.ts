import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { baileysAdapter } from '@adapters/baileys'
import { zapoAdapter } from '@adapters/zapo'
import { snapshot } from '@api'
import {
    type IrAddress,
    irAddressKey,
    type IrGroupSender,
    irGroupSenderKey,
    type IrIdentity,
    type IrSenderKeyRecord,
    type IrSessionRecord,
    type IrSignedPreKey
} from '@ir'
import { buildSnapshot } from '@ir/builder'

import { fakeBaileysSnapshot, fb, pub33, SAMPLE_REGID } from './fixtures.js'

const FAKE_IDENTITY: IrIdentity = {
    noiseKeyPair: { pubKey: fb(0x11, 32), privKey: fb(0x12, 32) },
    signedIdentityKeyPair: { pubKey: pub33(0x10), privKey: fb(0x32, 32) },
    registrationId: SAMPLE_REGID,
    advSecretKey: fb(0xab, 32)
}

const FAKE_SPK: IrSignedPreKey = {
    keyId: 1,
    keyPair: { pubKey: fb(0x41, 32), privKey: fb(0x42, 32) },
    signature: fb(0x51, 64),
    uploaded: true
}

const FAKE_ADDR: IrAddress = { user: '5511888888888', device: 0 }
const FAKE_GROUP_SENDER: IrGroupSender = {
    groupId: 'group@g.us',
    sender: { user: '5511999999999', device: 0 }
}
const FAKE_SESSION: IrSessionRecord = { proto: fb(0xaa, 16) }
const FAKE_SENDER_KEY: IrSenderKeyRecord = { proto: fb(0xbb, 16) }

describe('buildSnapshot()', () => {
    test('produces a valid WaSnapshot with required scalars', () => {
        const ir = buildSnapshot({
            source: 'baileys',
            identity: FAKE_IDENTITY,
            signedPreKey: FAKE_SPK
        }).build()
        assert.equal(ir.schemaVersion, 1)
        assert.equal(ir.source, 'baileys')
        assert.deepEqual(ir.identity, FAKE_IDENTITY)
        assert.deepEqual(ir.signedPreKey, FAKE_SPK)
        assert.equal(ir.preKeys.size, 0)
        assert.equal(ir.sessions.size, 0)
    })

    test('addPreKey/addPreKeys populates the preKeys map keyed by id', () => {
        const ir = buildSnapshot({
            source: 'baileys',
            identity: FAKE_IDENTITY,
            signedPreKey: FAKE_SPK
        })
            .addPreKey({ keyId: 1, keyPair: FAKE_SPK.keyPair })
            .addPreKeys([
                { keyId: 2, keyPair: FAKE_SPK.keyPair },
                { keyId: 3, keyPair: FAKE_SPK.keyPair }
            ])
            .build()
        assert.equal(ir.preKeys.size, 3)
        assert.equal(ir.preKeys.get(1)?.keyId, 1)
        assert.equal(ir.preKeys.get(2)?.keyId, 2)
        assert.equal(ir.preKeys.get(3)?.keyId, 3)
    })

    test('addSession keys sessions by irAddressKey(address)', () => {
        const ir = buildSnapshot({
            source: 'baileys',
            identity: FAKE_IDENTITY,
            signedPreKey: FAKE_SPK
        })
            .addSession(FAKE_ADDR, FAKE_SESSION)
            .build()
        const key = irAddressKey(FAKE_ADDR)
        const got = ir.sessions.get(key)
        assert.ok(got)
        assert.deepEqual(got.address, FAKE_ADDR)
        assert.deepEqual(got.record, FAKE_SESSION)
    })

    test('addSenderKey keys senderKeys by irGroupSenderKey', () => {
        const ir = buildSnapshot({
            source: 'baileys',
            identity: FAKE_IDENTITY,
            signedPreKey: FAKE_SPK
        })
            .addSenderKey(FAKE_GROUP_SENDER, FAKE_SENDER_KEY)
            .build()
        const got = ir.senderKeys.get(irGroupSenderKey(FAKE_GROUP_SENDER))
        assert.ok(got)
        assert.deepEqual(got.groupSender, FAKE_GROUP_SENDER)
    })

    test('addSignalIdentity stores raw bytes keyed by address', () => {
        const idKey = pub33(0x20)
        const ir = buildSnapshot({
            source: 'baileys',
            identity: FAKE_IDENTITY,
            signedPreKey: FAKE_SPK
        })
            .addSignalIdentity(FAKE_ADDR, idKey)
            .build()
        const got = ir.signalIdentities.get(irAddressKey(FAKE_ADDR))
        assert.deepEqual(got, idKey)
    })

    test('built snapshot survives toJSON / fromJSON round-trip', () => {
        const ir = buildSnapshot({
            source: 'baileys',
            identity: FAKE_IDENTITY,
            signedPreKey: FAKE_SPK
        })
            .addPreKey({ keyId: 7, keyPair: FAKE_SPK.keyPair })
            .addSession(FAKE_ADDR, FAKE_SESSION)
            .build()
        const json = snapshot.toJSON(ir)
        const back = snapshot.fromJSON(JSON.parse(JSON.stringify(json)) as typeof json)
        assert.equal(back.preKeys.size, 1)
        assert.equal(back.sessions.size, 1)
    })

    test('built snapshot can be fed back into snapshot.to(lib, ir)', () => {
        // Use a real baileys-sourced IR so all the required fields the adapter
        // expects on round-trip are present.
        const ir = baileysAdapter.toCanonical(fakeBaileysSnapshot())
        const rebuilt = buildSnapshot({
            source: ir.source,
            identity: ir.identity,
            signedPreKey: ir.signedPreKey
        }).build()
        // rebuilt is minimal but consumable
        const zapoOut = snapshot.to('zapo', rebuilt)
        assert.equal(zapoOut.credentials.registrationInfo.registrationId, SAMPLE_REGID)
        // also confirm the round-trip works against the unrebuilt original
        const _full = zapoAdapter.fromCanonical(ir)
        assert.equal(_full.credentials.registrationInfo.registrationId, SAMPLE_REGID)
    })
})

describe('snapshot namespace', () => {
    test('snapshot.from + snapshot.to match adapter object path', () => {
        const data = fakeBaileysSnapshot()
        const viaNamespace = snapshot.to('zapo', snapshot.from('baileys', data))
        const viaAdapters = zapoAdapter.fromCanonical(baileysAdapter.toCanonical(data))
        assert.deepEqual(viaNamespace, viaAdapters)
    })
})
