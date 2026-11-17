import assert from 'node:assert/strict'
import { test } from 'node:test'

import { proto } from 'zapo-js/proto'
import {
    decodeSenderKeyRecord,
    decodeSignalSessionRecord,
    encodeSenderKeyRecord,
    encodeSignalSessionRecord
} from 'zapo-js/signal'

import { baileysAdapter, type BaileysAuthSnapshot } from '@adapters/baileys'
import { baileysSenderKeyToProto, protoToBaileysSenderKey } from '@adapters/baileys/sender-key'
import { baileysSessionToProto, protoToBaileysSession } from '@adapters/baileys/session'
import type { BaileysSerializedSessionEntry } from '@adapters/baileys/session-types'
import { zapoAdapter } from '@adapters/zapo'
import { migrate } from '@migrate'

function fb(b: number, len: number): Uint8Array {
    return new Uint8Array(len).fill(b)
}

// 33-byte Curve25519 pubkey with the libsignal `0x05` type prefix.
function pub33(b: number): Uint8Array {
    const out = new Uint8Array(33)
    out[0] = 0x05
    for (let i = 1; i < 33; i += 1) out[i] = b
    return out
}

function b64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64')
}

function fakeProtoSession(): Uint8Array {
    return encodeSignalSessionRecord({
        local: { regId: 1111, pubKey: pub33(0x10) },
        remote: { regId: 2222, pubKey: pub33(0x20) },
        rootKey: fb(0x30, 32),
        sendChain: {
            ratchetKey: { pubKey: pub33(0x40), privKey: fb(0x41, 32) },
            nextMsgIndex: 7,
            chainKey: fb(0x50, 32)
        },
        recvChains: [
            {
                senderRatchetKey: pub33(0x60),
                chainKey: { index: 3, key: fb(0x61, 32) },
                messageKeys: []
            }
        ],
        initialExchangeInfo: null,
        prevSendChainHighestIndex: 0,
        aliceBaseKey: pub33(0x70),
        prevSessions: []
    })
}

function fakeProtoSenderKey(): Uint8Array {
    return encodeSenderKeyRecord({
        groupId: 'group@g.us',
        sender: { user: '5511999999999', server: 's.whatsapp.net', device: 0 },
        keyId: 0xff,
        iteration: 12,
        chainKey: fb(0xa0, 32),
        signingPublicKey: pub33(0xb0),
        signingPrivateKey: fb(0xb1, 32),
        unusedMessageKeys: []
    })
}

test('baileys session: proto -> baileys serialized -> proto round-trips key state', () => {
    const proto1 = fakeProtoSession()
    const serialized = protoToBaileysSession(proto1)

    assert.equal(serialized.version, 'v1')
    assert.equal(Object.keys(serialized._sessions).length, 1)

    const proto2 = baileysSessionToProto(serialized, { regId: 1111, identityPubKey: pub33(0x10) })
    const decoded1 = decodeSignalSessionRecord(proto1) as {
        remote: { regId: number; pubKey: Uint8Array }
        rootKey: Uint8Array
    }
    const decoded2 = decodeSignalSessionRecord(proto2) as {
        remote: { regId: number; pubKey: Uint8Array }
        rootKey: Uint8Array
    }

    assert.equal(decoded2.remote.regId, decoded1.remote.regId)
    assert.deepEqual(decoded2.rootKey, decoded1.rootKey)
    assert.deepEqual(decoded2.remote.pubKey, decoded1.remote.pubKey)
})

function baileysEntry(seed: number, closed: number): BaileysSerializedSessionEntry {
    const ratchetPub = pub33(seed + 1)
    const recvPub = pub33(seed + 2)
    return {
        registrationId: 2222,
        currentRatchet: {
            ephemeralKeyPair: { pubKey: ratchetPub, privKey: fb(seed + 3, 32) },
            lastRemoteEphemeralKey: recvPub,
            previousCounter: 0,
            rootKey: fb(seed + 4, 32)
        },
        indexInfo: {
            baseKey: pub33(seed + 5),
            baseKeyType: 1,
            closed,
            used: 1000 + seed,
            created: 1000 + seed,
            remoteIdentityKey: pub33(0x20)
        },
        _chains: {
            [b64(ratchetPub)]: {
                chainKey: { counter: 4, key: fb(seed + 6, 32) },
                chainType: 1,
                messageKeys: {}
            },
            [b64(recvPub)]: {
                chainKey: { counter: 2, key: fb(seed + 7, 32) },
                chainType: 2,
                messageKeys: {}
            }
        }
    }
}

// go.mau.fi/libsignal decodes every previous state on load and panics on an
// empty identity key, so archived entries must keep the full session state.
test('baileys session: closed entries become complete previous sessions', () => {
    const open = baileysEntry(0x40, -1)
    const closed = baileysEntry(0x80, 900)
    const bytes = baileysSessionToProto(
        {
            version: 'v1',
            _sessions: {
                [b64(open.indexInfo.baseKey as Uint8Array)]: open,
                [b64(closed.indexInfo.baseKey as Uint8Array)]: closed
            }
        },
        { regId: 1111, identityPubKey: pub33(0x10) }
    )

    const record = proto.RecordStructure.decode(bytes)
    assert.equal(record.previousSessions.length, 1)
    const prev = record.previousSessions[0]!
    assert.deepEqual(prev.localIdentityPublic, pub33(0x10))
    assert.deepEqual(prev.remoteIdentityPublic, pub33(0x20))
    assert.equal(prev.localRegistrationId, 1111)
    assert.equal(prev.remoteRegistrationId, 2222)
    assert.deepEqual(prev.rootKey, fb(0x84, 32))
    assert.deepEqual(prev.senderChain?.senderRatchetKey, pub33(0x81))
    assert.deepEqual(prev.senderChain?.senderRatchetKeyPrivate, fb(0x83, 32))
    assert.deepEqual(prev.senderChain?.chainKey?.key, fb(0x86, 32))
    assert.equal(prev.senderChain?.chainKey?.index, 5)
    assert.equal(prev.receiverChains?.length, 1)
    assert.deepEqual(prev.receiverChains?.[0]?.senderRatchetKey, pub33(0x82))
})

test('baileys sender-key: proto -> baileys states -> proto preserves the latest state', () => {
    const proto1 = fakeProtoSenderKey()
    const sender = { user: '5511999999999', server: 's.whatsapp.net' as const, device: 0 }
    const states = protoToBaileysSenderKey(proto1, 'group@g.us', sender)
    assert.equal(states.length, 1)
    assert.equal(states[0]?.senderKeyId, 0xff)

    const proto2 = baileysSenderKeyToProto(states, 'group@g.us', sender)
    const decoded1 = decodeSenderKeyRecord(proto1, 'group@g.us', sender) as {
        keyId: number
        iteration: number
        chainKey: Uint8Array
    }
    const decoded2 = decodeSenderKeyRecord(proto2, 'group@g.us', sender) as {
        keyId: number
        iteration: number
        chainKey: Uint8Array
    }

    assert.equal(decoded2.keyId, decoded1.keyId)
    assert.equal(decoded2.iteration, decoded1.iteration)
    assert.deepEqual(decoded2.chainKey, decoded1.chainKey)
})

test('baileys -> zapo: full migration including a session entry', () => {
    const sessionAddr = '5511888888888:0'
    const sessionProto = fakeProtoSession()
    const baileysSerialized = protoToBaileysSession(sessionProto)

    const data: BaileysAuthSnapshot = {
        creds: {
            noiseKey: { public: fb(0x11, 32), private: fb(0x12, 32) },
            pairingEphemeralKeyPair: { public: fb(0x21, 32), private: fb(0x22, 32) },
            signedIdentityKey: { public: pub33(0x10), private: fb(0x32, 32) },
            signedPreKey: {
                keyPair: { public: fb(0x41, 32), private: fb(0x42, 32) },
                signature: fb(0x51, 64),
                keyId: 1
            },
            registrationId: 1111,
            advSecretKey: Buffer.from(fb(0xab, 32)).toString('base64'),
            firstUnuploadedPreKeyId: 5,
            nextPreKeyId: 5
        },
        keys: {
            session: { [sessionAddr]: baileysSerialized }
        }
    }

    const {
        data: zapo,
        snapshot,
        losses
    } = migrate({ from: baileysAdapter, to: zapoAdapter, data })

    assert.equal(snapshot.sessions.size, 1)
    assert.ok(zapo.sessions)
    assert.equal(zapo.sessions?.length, 1)
    assert.equal(zapo.sessions?.[0]?.address.user, '5511888888888')

    // sessions are flagged lossy on baileys but not as drops
    assert.equal(losses.filter((l) => l.severity === 'drop').length, 0)
})
