import assert from 'node:assert/strict'
import { test } from 'node:test'

import { baileysAdapter, type BaileysAuthSnapshot } from '@adapters/baileys'
import { zapoAdapter } from '@adapters/zapo'
import { migrate, planLosses } from '@migrate'

function bytes(...vals: number[]): Uint8Array {
    return Uint8Array.from(vals)
}

function fixedBytes(b: number, len: number): Uint8Array {
    return new Uint8Array(len).fill(b)
}

function fakeBaileysSnapshot(): BaileysAuthSnapshot {
    return {
        creds: {
            noiseKey: { public: fixedBytes(0x11, 32), private: fixedBytes(0x12, 32) },
            pairingEphemeralKeyPair: {
                public: fixedBytes(0x21, 32),
                private: fixedBytes(0x22, 32)
            },
            signedIdentityKey: { public: fixedBytes(0x31, 32), private: fixedBytes(0x32, 32) },
            signedPreKey: {
                keyPair: { public: fixedBytes(0x41, 32), private: fixedBytes(0x42, 32) },
                signature: fixedBytes(0x51, 64),
                keyId: 1
            },
            registrationId: 4242,
            advSecretKey: Buffer.from(fixedBytes(0xab, 32)).toString('base64'),
            account: {
                details: bytes(1, 2, 3),
                accountSignatureKey: fixedBytes(0xa1, 32),
                accountSignature: fixedBytes(0xa2, 64),
                deviceSignature: fixedBytes(0xa3, 64)
            },
            me: { id: '5511999999999@s.whatsapp.net', lid: '11111@lid', name: 'Tester' },
            signalIdentities: [
                {
                    identifier: { name: '5511888888888@s.whatsapp.net', deviceId: 0 },
                    identifierKey: fixedBytes(0xc1, 33)
                }
            ],
            firstUnuploadedPreKeyId: 11,
            nextPreKeyId: 30,
            platform: 'android',
            routingInfo: bytes(0x05, 0x07)
        },
        keys: {
            'pre-key': {
                '1': { public: fixedBytes(0x61, 32), private: fixedBytes(0x62, 32) },
                '2': { public: fixedBytes(0x71, 32), private: fixedBytes(0x72, 32) }
            },
            'app-state-sync-key': {
                [Buffer.from(bytes(0xde, 0xad)).toString('base64')]: {
                    keyData: fixedBytes(0xee, 32),
                    timestamp: 1700000000,
                    fingerprint: { rawId: 7, currentIndex: 0, deviceIndexes: [0, 1] }
                }
            },
            'app-state-sync-version': {
                critical_unblock_low: {
                    version: 5,
                    hash: fixedBytes(0xbb, 128),
                    indexValueMap: {
                        [Buffer.from(bytes(1, 2, 3)).toString('base64')]: {
                            valueMac: fixedBytes(0xcc, 32)
                        }
                    }
                }
            },
            tctoken: {
                '5511777777777@s.whatsapp.net': {
                    token: fixedBytes(0x99, 32),
                    timestamp: '1700000123'
                }
            },
            'device-list': {
                '5511666666666@s.whatsapp.net': [
                    '5511666666666:1@s.whatsapp.net',
                    '5511666666666:2@s.whatsapp.net'
                ]
            }
        }
    }
}

test('baileys -> zapo: identity, signedPreKey, preKeys round-trip cleanly', () => {
    const baileys = fakeBaileysSnapshot()
    const {
        data: zapo,
        snapshot,
        losses
    } = migrate({
        from: baileysAdapter,
        to: zapoAdapter,
        data: baileys
    })

    assert.equal(snapshot.source, 'baileys')
    assert.equal(zapo.credentials.registrationInfo.registrationId, 4242)
    assert.deepEqual(zapo.credentials.advSecretKey, fixedBytes(0xab, 32))
    assert.equal(zapo.credentials.meJid, '5511999999999@s.whatsapp.net')
    assert.equal(zapo.credentials.signedPreKey.keyId, 1)
    assert.equal(zapo.credentials.platform, 'android')

    assert.equal(zapo.preKeys?.length, 2)
    const preKey1 = zapo.preKeys?.find((k) => k.keyId === 1)
    assert.ok(preKey1)
    assert.equal(preKey1?.uploaded, true) // keyId < firstUnuploadedPreKeyId

    assert.equal(zapo.appState?.keys.length, 1)
    assert.ok(zapo.appState?.collections.critical_unblock_low)
    assert.equal(zapo.appState?.collections.critical_unblock_low?.version, 5)

    assert.equal(zapo.privacyTokens?.length, 1)
    assert.equal(zapo.deviceLists?.length, 1)

    // No drops expected for the domains exercised here.
    assert.equal(losses.filter((l) => l.severity === 'drop').length, 0)
})

test('zapo -> baileys round-trip preserves identity and core key material', () => {
    const baileys0 = fakeBaileysSnapshot()
    const zapo = migrate({ from: baileysAdapter, to: zapoAdapter, data: baileys0 }).data
    const baileys1 = migrate({ from: zapoAdapter, to: baileysAdapter, data: zapo }).data

    assert.deepEqual(baileys1.creds.noiseKey, baileys0.creds.noiseKey)
    assert.deepEqual(baileys1.creds.signedIdentityKey, baileys0.creds.signedIdentityKey)
    assert.deepEqual(baileys1.creds.signedPreKey, baileys0.creds.signedPreKey)
    assert.equal(baileys1.creds.registrationId, baileys0.creds.registrationId)
    assert.equal(baileys1.creds.advSecretKey, baileys0.creds.advSecretKey)
    assert.equal(baileys1.creds.me?.id, baileys0.creds.me?.id)
    assert.equal(baileys1.creds.me?.lid, baileys0.creds.me?.lid)
    assert.equal(baileys1.creds.platform, baileys0.creds.platform)
    assert.deepEqual(baileys1.creds.routingInfo, baileys0.creds.routingInfo)

    const k1 = baileys1.keys['pre-key']
    assert.ok(k1)
    assert.deepEqual(k1?.['1'], baileys0.keys['pre-key']?.['1'])
    assert.deepEqual(k1?.['2'], baileys0.keys['pre-key']?.['2'])

    assert.deepEqual(
        Object.keys(baileys1.keys['app-state-sync-version'] ?? {}).sort(),
        Object.keys(baileys0.keys['app-state-sync-version'] ?? {}).sort()
    )
})

test('migrate() reports drops when target adapter cannot write a domain', () => {
    // Forge a snapshot with messageSecrets (zapo can write them, baileys cannot).
    const baileys = fakeBaileysSnapshot()
    const { snapshot } = migrate({ from: baileysAdapter, to: zapoAdapter, data: baileys })

    const fakeWithSecrets = {
        ...snapshot,
        messageSecrets: new Map([
            [
                'msg1',
                { messageId: 'msg1', senderJid: 'x@s.whatsapp.net', secret: fixedBytes(0xff, 32) }
            ]
        ])
    }

    const losses = planLosses(zapoAdapter, baileysAdapter, fakeWithSecrets)
    const drops = losses.filter((l) => l.severity === 'drop')

    // baileys cannot write `messageSecrets` (and `contacts` is also non-writable
    // — exposed only as a read of `me` from creds, not persisted back).
    const messageSecretDrop = drops.find((l) => l.domain === 'messageSecrets')
    assert.ok(messageSecretDrop, 'expected messageSecrets to be reported as a drop')
    assert.equal(messageSecretDrop?.count, 1)
})
