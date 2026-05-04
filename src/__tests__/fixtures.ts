import { proto } from 'zapo-js/proto'
import { encodeSenderKeyRecord, encodeSignalSessionRecord } from 'zapo-js/signal'

import type { BaileysAuthSnapshot } from '@adapters/baileys'
import { protoToBaileysSenderKey } from '@adapters/baileys/sender-key'
import { protoToBaileysSession } from '@adapters/baileys/session'
import type { WaWebSnapshot } from '@adapters/wa-web'
import type { WhatsappRustSnapshot } from '@adapters/whatsapp-rust'
import type { WhatsmeowSnapshot } from '@adapters/whatsmeow'
import {
    protoToWhatsmeowSenderKeyJson,
    protoToWhatsmeowSessionJson
} from '@adapters/whatsmeow/go-libsignal-codec'
import type { ZapoStoreSnapshot } from '@adapters/zapo'

export function fb(b: number, len: number): Uint8Array {
    return new Uint8Array(len).fill(b)
}

/** 33-byte Curve25519 pubkey with the libsignal `0x05` type prefix. */
export function pub33(b: number): Uint8Array {
    const out = new Uint8Array(33)
    out[0] = 0x05
    for (let i = 1; i < 33; i += 1) out[i] = b
    return out
}

export function fakeSessionProto(): Uint8Array {
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
                nextMsgIndex: 3,
                chainKey: fb(0x61, 32),
                unusedMsgKeys: []
            }
        ],
        initialExchangeInfo: null,
        prevSendChainHighestIndex: 0,
        aliceBaseKey: pub33(0x70),
        prevSessions: []
    })
}

export function fakeSenderKeyProto(): Uint8Array {
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

export const SAMPLE_USER_JID = '5511999999999@s.whatsapp.net'
export const SAMPLE_REMOTE_JID = '5511888888888@s.whatsapp.net'
export const SAMPLE_GROUP_ID = 'group@g.us'
export const SAMPLE_REGID = 1111

const SESSION_BYTES = fakeSessionProto()
const SENDER_KEY_BYTES = fakeSenderKeyProto()

const ME_LOCAL = { regId: SAMPLE_REGID, identityPubKey: pub33(0x10) }

export function fakeBaileysSnapshot(): BaileysAuthSnapshot {
    return {
        creds: {
            noiseKey: { public: fb(0x11, 32), private: fb(0x12, 32) },
            pairingEphemeralKeyPair: { public: fb(0x21, 32), private: fb(0x22, 32) },
            signedIdentityKey: { public: pub33(0x10), private: fb(0x32, 32) },
            signedPreKey: {
                keyPair: { public: fb(0x41, 32), private: fb(0x42, 32) },
                signature: fb(0x51, 64),
                keyId: 1
            },
            registrationId: SAMPLE_REGID,
            advSecretKey: Buffer.from(fb(0xab, 32)).toString('base64'),
            account: {
                details: fb(0x01, 8),
                accountSignatureKey: fb(0xa1, 32),
                accountSignature: fb(0xa2, 64),
                deviceSignature: fb(0xa3, 64)
            },
            me: { id: SAMPLE_USER_JID, lid: '11111@lid', name: 'Tester' },
            signalIdentities: [
                {
                    identifier: { name: SAMPLE_REMOTE_JID, deviceId: 0 },
                    identifierKey: pub33(0x20)
                }
            ],
            firstUnuploadedPreKeyId: 11,
            nextPreKeyId: 30,
            platform: 'android',
            routingInfo: fb(0x05, 2)
        },
        keys: {
            'pre-key': {
                '1': { public: fb(0x61, 32), private: fb(0x62, 32) },
                '2': { public: fb(0x71, 32), private: fb(0x72, 32) }
            },
            session: {
                ['5511888888888:0']: protoToBaileysSession(SESSION_BYTES)
            },
            'sender-key': {
                [`${SAMPLE_GROUP_ID}::5511999999999:0`]: protoToBaileysSenderKey(
                    SENDER_KEY_BYTES,
                    SAMPLE_GROUP_ID,
                    { user: '5511999999999', server: 's.whatsapp.net', device: 0 }
                )
            },
            'app-state-sync-key': {
                [Buffer.from(fb(0xde, 4)).toString('base64')]: {
                    keyData: fb(0xee, 32),
                    timestamp: 1700000000,
                    fingerprint: { rawId: 7, currentIndex: 0, deviceIndexes: [0, 1] }
                }
            },
            'app-state-sync-version': {
                critical_unblock_low: {
                    version: 5,
                    hash: fb(0xbb, 128),
                    indexValueMap: {
                        [Buffer.from(fb(0x01, 8)).toString('base64')]: { valueMac: fb(0xcc, 32) }
                    }
                }
            },
            tctoken: {
                '5511777777777@s.whatsapp.net': {
                    token: fb(0x99, 32),
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

export function fakeZapoSnapshot(): ZapoStoreSnapshot {
    return {
        credentials: {
            noiseKeyPair: { pubKey: fb(0x11, 32), privKey: fb(0x12, 32) },
            registrationInfo: {
                registrationId: SAMPLE_REGID,
                identityKeyPair: { pubKey: pub33(0x10), privKey: fb(0x32, 32) }
            },
            signedPreKey: {
                keyId: 1,
                keyPair: { pubKey: fb(0x41, 32), privKey: fb(0x42, 32) },
                signature: fb(0x51, 64),
                uploaded: true
            },
            advSecretKey: fb(0xab, 32),
            signedIdentity: {
                details: fb(0x01, 8),
                accountSignatureKey: fb(0xa1, 32),
                accountSignature: fb(0xa2, 64),
                deviceSignature: fb(0xa3, 64)
            },
            meJid: SAMPLE_USER_JID,
            meLid: '11111@lid',
            meDisplayName: 'Tester',
            platform: 'android',
            routingInfo: fb(0x05, 2)
        },
        preKeys: [
            { keyId: 1, keyPair: { pubKey: fb(0x61, 32), privKey: fb(0x62, 32) }, uploaded: true },
            { keyId: 2, keyPair: { pubKey: fb(0x71, 32), privKey: fb(0x72, 32) }, uploaded: false }
        ],
        identities: [
            {
                address: { user: '5511888888888', server: 's.whatsapp.net', device: 0 },
                identityKey: pub33(0x20)
            }
        ]
    }
}

export function fakeWhatsmeowSnapshot(): WhatsmeowSnapshot {
    return {
        device: {
            noiseKey: { pubKey: fb(0x11, 32), privKey: fb(0x12, 32) },
            identityKey: { pubKey: pub33(0x10), privKey: fb(0x32, 32) },
            signedPreKey: {
                keyId: 1,
                keyPair: { pubKey: fb(0x41, 32), privKey: fb(0x42, 32) },
                signature: fb(0x51, 64)
            },
            registrationId: SAMPLE_REGID,
            advSecretKey: fb(0xab, 32),
            account: {
                details: fb(0x01, 8),
                accountSignatureKey: fb(0xa1, 32),
                accountSignature: fb(0xa2, 64),
                deviceSignature: fb(0xa3, 64)
            },
            meJid: SAMPLE_USER_JID,
            meLid: '11111@lid',
            platform: 'android',
            pushName: 'Tester'
        },
        preKeys: [
            { keyId: 1, keyPair: { pubKey: fb(0x61, 32), privKey: fb(0x62, 32) }, uploaded: true }
        ],
        identities: [{ addr: '5511888888888:0', identityKey: pub33(0x20) }],
        // whatsmeow persists sessions/sender-keys as the UTF-8 bytes of
        // go.mau.fi/libsignal's JSON struct serializer, NOT raw libsignal proto.
        sessions: [
            { addr: '5511888888888:0', session: protoToWhatsmeowSessionJson(SESSION_BYTES) }
        ],
        senderKeys: [
            {
                groupId: SAMPLE_GROUP_ID,
                senderAddr: '5511999999999:0',
                record: protoToWhatsmeowSenderKeyJson(SENDER_KEY_BYTES)
            }
        ],
        contacts: [{ jid: '5511555555555@s.whatsapp.net', fullName: 'Friend', pushName: 'Pal' }],
        privacyTokens: [
            { userJid: '5511777777777@s.whatsapp.net', token: fb(0x99, 32), timestampS: 1700000123 }
        ],
        messageSecrets: [
            {
                chatJid: SAMPLE_GROUP_ID,
                senderJid: SAMPLE_USER_JID,
                messageId: 'msg-id-1',
                key: fb(0xff, 32)
            }
        ]
    }
}

export function fakeWaWebSnapshot(): WaWebSnapshot {
    return {
        device: {
            noiseKey: { pubKey: fb(0x11, 32), privKey: fb(0x12, 32) },
            identityKey: { pubKey: pub33(0x10), privKey: fb(0x32, 32) },
            signedPreKey: {
                keyId: 1,
                keyPair: { pubKey: fb(0x41, 32), privKey: fb(0x42, 32) },
                signature: fb(0x51, 64)
            },
            registrationId: SAMPLE_REGID,
            advSecretKey: fb(0xab, 32),
            account: {
                details: fb(0x01, 8),
                accountSignatureKey: fb(0xa1, 32),
                accountSignature: fb(0xa2, 64),
                deviceSignature: fb(0xa3, 64)
            },
            meJid: SAMPLE_USER_JID,
            meLid: '11111@lid',
            platform: 'web'
        },
        preKeys: [
            { keyId: 1, keyPair: { pubKey: fb(0x61, 32), privKey: fb(0x62, 32) }, uploaded: true }
        ],
        identities: [{ jid: '5511888888888@s.whatsapp.net', device: 0, identityKey: pub33(0x20) }],
        sessions: [{ jid: '5511888888888@s.whatsapp.net', device: 0, session: SESSION_BYTES }],
        senderKeys: [
            {
                groupId: SAMPLE_GROUP_ID,
                senderJid: SAMPLE_USER_JID,
                senderDevice: 0,
                record: SENDER_KEY_BYTES
            }
        ],
        privacyTokens: [
            { jid: '5511777777777@s.whatsapp.net', token: fb(0x99, 32), timestampMs: 1700000123000 }
        ],
        contacts: [{ jid: '5511555555555@s.whatsapp.net', displayName: 'Friend' }],
        appStateSyncKeys: [{ keyId: fb(0xde, 4), keyData: fb(0xee, 32), timestamp: 1700000000 }],
        appStateVersions: [
            {
                collection: 'critical_block',
                version: 7,
                hash: fb(0xbb, 128),
                indexValueMap: { [Buffer.from(fb(0x01, 8)).toString('base64')]: fb(0xcc, 32) }
            }
        ],
        deviceLists: [
            {
                userJid: '5511666666666@s.whatsapp.net',
                deviceIds: [0, 1, 2],
                timestampMs: 1700001000000
            }
        ],
        messageSecrets: [
            {
                messageId: 'MSG-1',
                senderJid: SAMPLE_USER_JID,
                chatJid: SAMPLE_GROUP_ID,
                secret: fb(0xff, 32)
            }
        ]
    }
}

export function fakeWhatsappRustSnapshot(): WhatsappRustSnapshot {
    // rust packs the four ADV identity fields into one proto blob.
    const accountBytes = new Uint8Array(
        proto.ADVSignedDeviceIdentity.encode({
            details: fb(0x01, 8),
            accountSignatureKey: fb(0xa1, 32),
            accountSignature: fb(0xa2, 64),
            deviceSignature: fb(0xa3, 64)
        }).finish()
    )
    return {
        device: {
            registrationId: SAMPLE_REGID,
            noiseKey: { pubKey: fb(0x11, 32), privKey: fb(0x12, 32) },
            identityKey: { pubKey: fb(0x10, 32), privKey: fb(0x32, 32) },
            signedPreKey: { pubKey: fb(0x41, 32), privKey: fb(0x42, 32) },
            signedPreKeyId: 1,
            signedPreKeySignature: fb(0x51, 64),
            advSecretKey: fb(0xab, 32),
            account: accountBytes,
            pn: SAMPLE_USER_JID,
            lid: '11111@lid',
            pushName: 'Tester',
            edgeRoutingInfo: fb(0x05, 2)
        },
        preKeys: [
            { keyId: 1, keyPair: { pubKey: fb(0x61, 32), privKey: fb(0x62, 32) }, uploaded: true }
        ],
        identities: [{ address: '5511888888888@s.whatsapp.net.0', key: pub33(0x20) }],
        sessions: [{ address: '5511888888888@s.whatsapp.net.0', record: SESSION_BYTES }],
        senderKeys: [
            {
                address: `${SAMPLE_GROUP_ID}:5511999999999@s.whatsapp.net.0`,
                record: SENDER_KEY_BYTES
            }
        ],
        tcTokens: [
            {
                jid: '5511777777777@s.whatsapp.net',
                token: fb(0x99, 32),
                tokenTimestamp: 1700000123
            }
        ],
        appStateKeys: [{ keyId: fb(0xde, 4), keyData: fb(0xee, 32) }],
        appStateVersions: [
            {
                name: 'critical_block',
                stateData: new Uint8Array([7, ...new Array<number>(128).fill(0xbb), 0])
            }
        ],
        appStateMutationMacs: [
            {
                name: 'critical_block',
                version: 7,
                indexMac: fb(0x01, 8),
                valueMac: fb(0xcc, 32)
            }
        ],
        deviceRegistry: [
            {
                userJid: '5511666666666@s.whatsapp.net',
                devicesJson: JSON.stringify([{ id: 0 }, { id: 1 }, { id: 2 }]),
                timestamp: 1700001000
            }
        ]
    }
}

export { ME_LOCAL }
