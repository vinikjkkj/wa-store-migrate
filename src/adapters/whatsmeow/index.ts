import { decodeAppStateFingerprint, encodeAppStateFingerprint } from 'zapo-js/appstate'

import type { AdapterCapabilities, IrDomain, StoreAdapter } from '@adapter'
import { parseLibsignalAddress } from '@codec/address'
import {
    emptySnapshot,
    irAddressKey,
    type IrAppStateSyncKey,
    irGroupSenderKey,
    type IrIdentity,
    type IrLTHashState,
    type IrPreKey,
    type IrSignedPreKey,
    type WaSnapshot
} from '@ir'

import {
    protoToWhatsmeowSenderKeyJson,
    protoToWhatsmeowSessionJson,
    whatsmeowSenderKeyJsonToProto,
    whatsmeowSessionJsonToProto
} from './go-libsignal-codec.js'
import type { WhatsmeowSnapshot } from './types.js'

const READ: ReadonlySet<IrDomain> = new Set<IrDomain>([
    'identity',
    'signedPreKey',
    'preKeys',
    'signalIdentities',
    'sessions',
    'senderKeys',
    'appStateSyncKeys',
    'appStateVersions',
    'contacts',
    'privacyTokens',
    'messageSecrets'
])

const WRITE: ReadonlySet<IrDomain> = READ

const capabilities: AdapterCapabilities = { read: READ, write: WRITE }

function identityFromDevice(snap: WhatsmeowSnapshot): IrIdentity {
    const d = snap.device
    return {
        noiseKeyPair: d.noiseKey,
        signedIdentityKeyPair: d.identityKey,
        registrationId: d.registrationId,
        advSecretKey: d.advSecretKey,
        ...(d.account
            ? {
                  signedIdentity: {
                      ...(d.account.details ? { details: d.account.details } : {}),
                      ...(d.account.accountSignatureKey
                          ? { accountSignatureKey: d.account.accountSignatureKey }
                          : {}),
                      ...(d.account.accountSignature
                          ? { accountSignature: d.account.accountSignature }
                          : {}),
                      ...(d.account.deviceSignature
                          ? { deviceSignature: d.account.deviceSignature }
                          : {})
                  }
              }
            : {}),
        ...(d.meJid ? { meJid: d.meJid } : {}),
        ...(d.meLid ? { meLid: d.meLid } : {}),
        ...(d.pushName ? { meDisplayName: d.pushName } : {}),
        ...(d.platform ? { platform: d.platform } : {})
    }
}

function signedPreKey(snap: WhatsmeowSnapshot): IrSignedPreKey {
    const spk = snap.device.signedPreKey
    return {
        keyId: spk.keyId,
        keyPair: spk.keyPair,
        signature: spk.signature,
        uploaded: true
    }
}

function fingerprintFromBytes(bytes: Uint8Array | undefined) {
    if (!bytes || bytes.length === 0) return undefined
    const decoded = decodeAppStateFingerprint(bytes) as
        | { rawId?: number; currentIndex?: number; deviceIndexes?: readonly number[] }
        | undefined
    return decoded
}

// whatsmeow keys its stores by `<user>[_<agent>]:<device>` (agent=1 for LID).
function formatWhatsmeowAddr(addr: {
    user: string
    device: number
    server?: 'lid' | 's.whatsapp.net'
}): string {
    const isLid = addr.server === 'lid'
    const signalUser = isLid ? `${addr.user}_1` : addr.user
    return `${signalUser}:${addr.device}`
}

function parseWhatsmeowAddr(s: string) {
    if (s.includes('@')) return parseLibsignalAddress(s)
    const colon = s.lastIndexOf(':')
    if (colon < 0) return parseLibsignalAddress(s)
    const head = s.slice(0, colon)
    const device = Number(s.slice(colon + 1))
    if (!Number.isFinite(device)) return parseLibsignalAddress(s)
    const underscore = head.lastIndexOf('_')
    if (underscore < 0) {
        return { user: head, device }
    }
    const dt = Number(head.slice(underscore + 1))
    if (!Number.isFinite(dt)) return parseLibsignalAddress(s)
    return {
        user: head.slice(0, underscore),
        device,
        ...(dt === 1 ? { server: 'lid' as const } : {})
    }
}

export const whatsmeowAdapter: StoreAdapter<WhatsmeowSnapshot, WhatsmeowSnapshot> = {
    id: 'whatsmeow',
    capabilities,
    toCanonical(input: WhatsmeowSnapshot): WaSnapshot {
        const snap = emptySnapshot('whatsmeow', identityFromDevice(input), signedPreKey(input))

        if (input.preKeys) {
            for (const k of input.preKeys) {
                const pre: IrPreKey = { keyId: k.keyId, keyPair: k.keyPair, uploaded: k.uploaded }
                snap.preKeys.set(k.keyId, pre)
            }
        }

        if (input.identities) {
            for (const id of input.identities) {
                snap.signalIdentities.set(id.addr, id.identityKey)
            }
        }

        if (input.sessions) {
            for (const s of input.sessions) {
                const addr = parseWhatsmeowAddr(s.addr)
                // whatsmeow stores sessions as the JSON output of
                // go.mau.fi/libsignal's struct serializer — convert to proto
                // bytes for the IR.
                const proto = whatsmeowSessionJsonToProto(s.session)
                snap.sessions.set(irAddressKey(addr), {
                    address: addr,
                    record: { proto }
                })
            }
        }

        if (input.senderKeys) {
            for (const sk of input.senderKeys) {
                const sender = parseWhatsmeowAddr(sk.senderAddr)
                const groupSender = { groupId: sk.groupId, sender }
                const proto = whatsmeowSenderKeyJsonToProto(sk.record)
                snap.senderKeys.set(irGroupSenderKey(groupSender), {
                    groupSender,
                    record: { proto }
                })
            }
        }

        if (input.appStateSyncKeys) {
            for (const k of input.appStateSyncKeys) {
                const fp = fingerprintFromBytes(k.fingerprint)
                const ir: IrAppStateSyncKey = {
                    keyId: k.keyId,
                    keyData: k.keyData,
                    timestamp: k.timestamp,
                    ...(fp ? { fingerprint: fp } : {})
                }
                snap.appStateSyncKeys.set(Buffer.from(k.keyId).toString('base64'), ir)
            }
        }

        if (input.appStateVersions) {
            for (const v of input.appStateVersions) {
                const indexValueMap = new Map<string, Uint8Array>()
                if (input.appStateMutationMacs) {
                    for (const m of input.appStateMutationMacs) {
                        if (m.collection !== v.collection) continue
                        indexValueMap.set(Buffer.from(m.indexMac).toString('base64'), m.valueMac)
                    }
                }
                const ir: IrLTHashState = {
                    collection: v.collection,
                    version: v.version,
                    hash: v.hash,
                    indexValueMap
                }
                snap.appStateVersions.set(v.collection, ir)
            }
        }

        if (input.contacts) {
            for (const c of input.contacts) {
                snap.contacts.set(c.jid, {
                    jid: c.jid,
                    ...((c.fullName ?? c.firstName)
                        ? { displayName: c.fullName ?? c.firstName }
                        : {}),
                    ...(c.pushName ? { pushName: c.pushName } : {}),
                    ...(c.businessName ? { verifiedName: c.businessName } : {})
                })
            }
        }

        if (input.privacyTokens) {
            for (const t of input.privacyTokens) {
                snap.privacyTokens.set(t.userJid, {
                    jid: t.userJid,
                    token: t.token,
                    timestampMs: t.timestampS * 1000
                })
            }
        }

        if (input.messageSecrets) {
            for (const m of input.messageSecrets) {
                snap.messageSecrets.set(m.messageId, {
                    messageId: m.messageId,
                    senderJid: m.senderJid,
                    chatJid: m.chatJid,
                    secret: m.key
                })
            }
        }

        return snap
    },
    fromCanonical(snap: WaSnapshot): WhatsmeowSnapshot {
        const id = snap.identity
        const spk = snap.signedPreKey
        const device = {
            noiseKey: id.noiseKeyPair,
            identityKey: id.signedIdentityKeyPair,
            signedPreKey: { keyId: spk.keyId, keyPair: spk.keyPair, signature: spk.signature },
            registrationId: id.registrationId,
            advSecretKey: id.advSecretKey,
            ...(id.signedIdentity ? { account: id.signedIdentity } : {}),
            ...(id.platform ? { platform: id.platform } : {}),
            ...(id.meDisplayName ? { pushName: id.meDisplayName } : {}),
            ...(id.meJid ? { meJid: id.meJid } : {}),
            ...(id.meLid ? { meLid: id.meLid } : {})
        }

        const out: {
            -readonly [K in keyof WhatsmeowSnapshot]: WhatsmeowSnapshot[K] extends
                | readonly (infer U)[]
                | undefined
                ? U[]
                : WhatsmeowSnapshot[K]
        } = { device }

        if (snap.preKeys.size > 0) {
            out.preKeys = [...snap.preKeys.values()].map((k) => ({
                keyId: k.keyId,
                keyPair: k.keyPair,
                uploaded: k.uploaded ?? false
            }))
        }
        if (snap.signalIdentities.size > 0) {
            out.identities = [...snap.signalIdentities].map(([addr, identityKey]) => ({
                addr,
                identityKey
            }))
        }
        if (snap.sessions.size > 0) {
            out.sessions = [...snap.sessions.values()].map(({ address, record }) => ({
                addr: formatWhatsmeowAddr(address),
                session: protoToWhatsmeowSessionJson(record.proto)
            }))
        }
        if (snap.senderKeys.size > 0) {
            out.senderKeys = [...snap.senderKeys.values()].map(({ groupSender, record }) => ({
                groupId: groupSender.groupId,
                senderAddr: formatWhatsmeowAddr(groupSender.sender),
                record: protoToWhatsmeowSenderKeyJson(record.proto)
            }))
        }
        if (snap.appStateSyncKeys.size > 0) {
            out.appStateSyncKeys = [...snap.appStateSyncKeys.values()].map((k) => {
                const fp = encodeAppStateFingerprint(
                    (k.fingerprint ?? {}) as Parameters<typeof encodeAppStateFingerprint>[0]
                )
                return {
                    keyId: k.keyId,
                    keyData: k.keyData,
                    timestamp: k.timestamp ?? 0,
                    fingerprint: fp ?? new Uint8Array(0)
                }
            })
        }
        if (snap.appStateVersions.size > 0) {
            out.appStateVersions = [...snap.appStateVersions.values()].map((v) => ({
                collection: v.collection,
                version: v.version,
                hash: v.hash
            }))
            out.appStateMutationMacs = []
            for (const v of snap.appStateVersions.values()) {
                for (const [indexMacB64, valueMac] of v.indexValueMap) {
                    out.appStateMutationMacs.push({
                        collection: v.collection,
                        version: v.version,
                        indexMac: Uint8Array.from(Buffer.from(indexMacB64, 'base64')),
                        valueMac
                    })
                }
            }
        }
        if (snap.contacts.size > 0) {
            out.contacts = [...snap.contacts.values()].map((c) => ({
                jid: c.jid,
                ...(c.displayName ? { fullName: c.displayName } : {}),
                ...(c.pushName ? { pushName: c.pushName } : {}),
                ...(c.verifiedName ? { businessName: c.verifiedName } : {})
            }))
        }
        if (snap.privacyTokens.size > 0) {
            out.privacyTokens = [...snap.privacyTokens.values()]
                .filter((t): t is typeof t & { token: Uint8Array } => Boolean(t.token))
                .map((t) => ({
                    userJid: t.jid,
                    token: t.token,
                    timestampS: Math.floor((t.timestampMs ?? 0) / 1000)
                }))
        }
        if (snap.messageSecrets.size > 0) {
            out.messageSecrets = [...snap.messageSecrets.values()].map((m) => ({
                chatJid: m.chatJid ?? m.senderJid,
                senderJid: m.senderJid,
                messageId: m.messageId,
                key: m.secret
            }))
        }

        return out
    }
}

export type * from './types.js'
