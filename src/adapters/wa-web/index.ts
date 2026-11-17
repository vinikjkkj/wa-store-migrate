import type { proto } from 'zapo-js/proto'
import { encodeSenderKeyRecord, encodeSignalSessionRecord } from 'zapo-js/signal'

import type { AdapterCapabilities, IrDomain, StoreAdapter } from '@adapter'
import { normalizeWaJid, normalizeWaServer } from '@codec/address'
import {
    emptySnapshot,
    type IrAddress,
    irAddressKey,
    irGroupSenderKey,
    type IrIdentity,
    type IrPreKey,
    type IrSignedPreKey,
    type WaSnapshot
} from '@ir'

import type { WaWebSnapshot } from './types.js'

// wa-web stores session records as decoded objects shaped like libsignal-node's
// runtime form: `serializedPubKey`/`privateKey` for ratchet keys, `ratchetPubKey`
// flat on recv chains, etc. zapo's `encodeSignalSessionRecord` expects the
// proto field names instead, so we remap before encoding.
interface WaWebSessionSnapshot {
    local: { regId: number; pubKey: Uint8Array }
    remote: { regId: number; pubKey: Uint8Array }
    rootKey: Uint8Array
    sendChain?: {
        ratchetKey: {
            serializedPubKey?: Uint8Array
            privateKey?: Uint8Array
            pubKey?: Uint8Array
            privKey?: Uint8Array
        }
        nextMsgIndex: number
        chainKey: Uint8Array
    }
    recvChains?: ReadonlyArray<{
        ratchetPubKey: Uint8Array
        nextMsgIndex: number
        chainKey: Uint8Array
        unusedMsgKeys?: ReadonlyArray<unknown>
    }>
    initialExchangeInfo?: unknown
    prevSendChainHighestIndex?: number
    // Archived sessions are already `SessionStructure` protos: WASignalSessions
    // decodes only the current session and writes `previousSessions` back as is.
    // zapo keeps them the same way, so they pass through unchanged.
    prevSessions?: ReadonlyArray<proto.ISessionStructure>
    aliceBaseKey?: Uint8Array
}

function waWebSessionToZapo(s: WaWebSessionSnapshot): unknown {
    const sendChain = s.sendChain
        ? {
              ratchetKey: {
                  pubKey: (s.sendChain.ratchetKey.serializedPubKey ??
                      s.sendChain.ratchetKey.pubKey)!,
                  privKey: (s.sendChain.ratchetKey.privateKey ?? s.sendChain.ratchetKey.privKey)!
              },
              nextMsgIndex: s.sendChain.nextMsgIndex,
              chainKey: s.sendChain.chainKey
          }
        : undefined
    const recvChains = (s.recvChains ?? []).map((c) => ({
        senderRatchetKey: c.ratchetPubKey,
        chainKey: { index: c.nextMsgIndex, key: c.chainKey },
        messageKeys: []
    }))
    return {
        local: s.local,
        remote: s.remote,
        rootKey: s.rootKey,
        sendChain,
        recvChains,
        initialExchangeInfo: s.initialExchangeInfo ?? null,
        prevSendChainHighestIndex: s.prevSendChainHighestIndex ?? 0,
        prevSessions: s.prevSessions ?? [],
        aliceBaseKey: s.aliceBaseKey ?? null
    }
}

function sessionToProto(session: Uint8Array | Record<string, unknown>): Uint8Array | null {
    if (session instanceof Uint8Array) return session
    // Skip partially-formed rows (deleted, mid-handshake) — zapo's encoder
    // asserts the required fields and would tank the whole migration.
    if (
        !session ||
        typeof session !== 'object' ||
        !session.local ||
        !session.remote ||
        !session.rootKey ||
        !session.sendChain
    ) {
        return null
    }
    const zapoShape = waWebSessionToZapo(session as unknown as WaWebSessionSnapshot)
    return encodeSignalSessionRecord(zapoShape as Parameters<typeof encodeSignalSessionRecord>[0])
}

function senderKeyToProto(
    record: Uint8Array | { senderKeyStates: readonly unknown[] } | null,
    groupId: string,
    sender: { user: string; server?: string; device: number }
): Uint8Array | null {
    if (record === null || record === undefined) return null
    if (record instanceof Uint8Array) return record
    const states = record.senderKeyStates
    if (!states || states.length === 0) return null
    // libsignal-node SenderKeyState shape — `senderSigningKeyPrivate` is
    // present only for sender-keys we own.
    const state = states[states.length - 1] as {
        senderKeyId: number
        senderKeyChainKey: { nextMsgIndex: number; chainKey: Uint8Array }
        senderSigningKeyPublic: Uint8Array
        senderSigningKeyPrivate?: Uint8Array
        unusedMsgKeys?: ReadonlyArray<{ iteration: number; seed: Uint8Array }>
    }
    if (
        !state.senderKeyChainKey ||
        !state.senderKeyChainKey.chainKey ||
        !state.senderSigningKeyPublic
    ) {
        return null
    }
    const zapoRecord = {
        groupId,
        sender,
        keyId: state.senderKeyId,
        iteration: state.senderKeyChainKey.nextMsgIndex,
        chainKey: state.senderKeyChainKey.chainKey,
        signingPublicKey: state.senderSigningKeyPublic,
        ...(state.senderSigningKeyPrivate
            ? { signingPrivateKey: state.senderSigningKeyPrivate }
            : {}),
        unusedMessageKeys: (state.unusedMsgKeys ?? []).map((k) => ({
            iteration: k.iteration,
            seed: k.seed
        }))
    }
    return encodeSenderKeyRecord(zapoRecord)
}

const READ: ReadonlySet<IrDomain> = new Set<IrDomain>([
    'identity',
    'signedPreKey',
    'preKeys',
    'signalIdentities',
    'sessions',
    'senderKeys',
    'appStateSyncKeys',
    'appStateVersions',
    'privacyTokens',
    'contacts',
    'deviceLists',
    'messageSecrets'
])

const WRITE: ReadonlySet<IrDomain> = READ

const capabilities: AdapterCapabilities = { read: READ, write: WRITE }

function identityFromDevice(input: WaWebSnapshot): IrIdentity {
    const d = input.device
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
        ...(d.meJid ? { meJid: normalizeWaJid(d.meJid) } : {}),
        ...(d.meLid ? { meLid: normalizeWaJid(d.meLid) } : {}),
        ...(d.platform ? { platform: d.platform } : {})
    }
}

function signedPreKey(input: WaWebSnapshot): IrSignedPreKey {
    const spk = input.device.signedPreKey
    return {
        keyId: spk.keyId,
        keyPair: spk.keyPair,
        signature: spk.signature,
        uploaded: true
    }
}

function jidToAddr(jid: string, device: number): IrAddress {
    // wa-web's libsignal-node format is `<user>[:<wa_device>]@<server>` where
    // `<wa_device>` is the WhatsApp companion device id. The libsignal device
    // separately tracked by `device` here is always 0 (signal device id),
    // not the WA device. If the jid carries a `:<wa_device>`, that's the
    // meaningful one — extract it and put in IR's `device` field.
    const at = jid.indexOf('@')
    let head = at >= 0 ? jid.slice(0, at) : jid
    const srv = at >= 0 ? jid.slice(at + 1) : ''
    let waDevice: number | undefined
    const colon = head.indexOf(':')
    if (colon >= 0) {
        const parsed = Number(head.slice(colon + 1))
        if (Number.isFinite(parsed)) waDevice = parsed
        head = head.slice(0, colon)
    }
    const out: { user: string; device: number; server?: 'lid' | 's.whatsapp.net' } = {
        user: head,
        device: waDevice ?? device
    }
    const normalized = at < 0 ? 's.whatsapp.net' : normalizeWaServer(srv)
    if (normalized !== null) out.server = normalized
    return out
}

function addrToJid(a: IrAddress): { jid: string; device: number } {
    const server = a.server ?? 's.whatsapp.net'
    return { jid: `${a.user}@${server}`, device: a.device }
}

export const waWebAdapter: StoreAdapter<WaWebSnapshot, WaWebSnapshot> = {
    id: 'wa-web',
    capabilities,
    toCanonical(input: WaWebSnapshot): WaSnapshot {
        const snap = emptySnapshot('wa-web', identityFromDevice(input), signedPreKey(input))

        if (input.preKeys) {
            for (const k of input.preKeys) {
                const pre: IrPreKey = {
                    keyId: k.keyId,
                    keyPair: k.keyPair,
                    ...(k.uploaded !== undefined ? { uploaded: k.uploaded } : {})
                }
                snap.preKeys.set(k.keyId, pre)
            }
        }

        if (input.identities) {
            for (const id of input.identities) {
                const addr = jidToAddr(id.jid, id.device)
                snap.signalIdentities.set(irAddressKey(addr), id.identityKey)
            }
        }

        if (input.sessions) {
            for (const s of input.sessions) {
                const addr = jidToAddr(s.jid, s.device)
                const proto = sessionToProto(s.session)
                if (!proto) continue
                snap.sessions.set(irAddressKey(addr), {
                    address: addr,
                    record: { proto }
                })
            }
        }

        if (input.senderKeys) {
            for (const sk of input.senderKeys) {
                const sender = jidToAddr(sk.senderJid, sk.senderDevice)
                const groupSender = { groupId: sk.groupId, sender }
                const proto = senderKeyToProto(sk.record, sk.groupId, {
                    user: sender.user,
                    ...(sender.server ? { server: sender.server } : {}),
                    device: sender.device
                })
                if (!proto) continue
                snap.senderKeys.set(irGroupSenderKey(groupSender), {
                    groupSender,
                    record: { proto }
                })
            }
        }

        if (input.appStateSyncKeys) {
            for (const k of input.appStateSyncKeys) {
                snap.appStateSyncKeys.set(Buffer.from(k.keyId).toString('base64'), {
                    keyId: k.keyId,
                    keyData: k.keyData,
                    timestamp: k.timestamp
                })
            }
        }

        if (input.appStateVersions) {
            for (const v of input.appStateVersions) {
                const indexValueMap = new Map<string, Uint8Array>()
                for (const [k2, v2] of Object.entries(v.indexValueMap)) indexValueMap.set(k2, v2)
                snap.appStateVersions.set(v.collection, {
                    collection: v.collection,
                    version: v.version,
                    hash: v.hash,
                    indexValueMap
                })
            }
        }

        if (input.privacyTokens) {
            for (const t of input.privacyTokens) {
                const jid = normalizeWaJid(t.jid)
                snap.privacyTokens.set(jid, {
                    jid,
                    token: t.token,
                    timestampMs: t.timestampMs
                })
            }
        }

        if (input.contacts) {
            for (const c of input.contacts) {
                const jid = normalizeWaJid(c.jid)
                snap.contacts.set(jid, {
                    jid,
                    ...(c.displayName ? { displayName: c.displayName } : {}),
                    ...(c.pushName ? { pushName: c.pushName } : {}),
                    ...(c.verifiedName ? { verifiedName: c.verifiedName } : {}),
                    ...(c.lid ? { lid: normalizeWaJid(c.lid) } : {}),
                    ...(c.phoneNumber ? { phoneNumber: c.phoneNumber } : {})
                })
            }
        }

        if (input.deviceLists) {
            for (const dl of input.deviceLists) {
                const userJid = normalizeWaJid(dl.userJid)
                const at = userJid.indexOf('@')
                const user = at >= 0 ? userJid.slice(0, at) : userJid
                const server = at >= 0 ? userJid.slice(at + 1) : 's.whatsapp.net'
                const deviceJids = dl.deviceIds.map((d) =>
                    d === 0 ? `${user}@${server}` : `${user}:${d}@${server}`
                )
                snap.deviceLists.set(userJid, {
                    userJid,
                    deviceJids,
                    updatedAtMs: dl.timestampMs
                })
            }
        }

        if (input.messageSecrets) {
            for (const s of input.messageSecrets) {
                snap.messageSecrets.set(s.messageId, {
                    messageId: s.messageId,
                    senderJid: normalizeWaJid(s.senderJid),
                    ...(s.chatJid ? { chatJid: normalizeWaJid(s.chatJid) } : {}),
                    secret: s.secret
                })
            }
        }

        return snap
    },
    fromCanonical(snap: WaSnapshot): WaWebSnapshot {
        const id = snap.identity
        const spk = snap.signedPreKey
        const device = {
            noiseKey: id.noiseKeyPair,
            identityKey: id.signedIdentityKeyPair,
            signedPreKey: { keyId: spk.keyId, keyPair: spk.keyPair, signature: spk.signature },
            registrationId: id.registrationId,
            advSecretKey: id.advSecretKey,
            ...(id.signedIdentity ? { account: id.signedIdentity } : {}),
            ...(id.meJid ? { meJid: id.meJid } : {}),
            ...(id.meLid ? { meLid: id.meLid } : {}),
            ...(id.platform ? { platform: id.platform } : {})
        }

        const out: {
            -readonly [K in keyof WaWebSnapshot]: WaWebSnapshot[K] extends
                | readonly (infer U)[]
                | undefined
                ? U[]
                : WaWebSnapshot[K]
        } = { device }

        if (snap.preKeys.size > 0) {
            out.preKeys = [...snap.preKeys.values()].map((k) => ({
                keyId: k.keyId,
                keyPair: k.keyPair,
                ...(k.uploaded !== undefined ? { uploaded: k.uploaded } : {})
            }))
        }
        if (snap.signalIdentities.size > 0) {
            out.identities = [...snap.signalIdentities].map(([key, identityKey]) => {
                const colon = key.lastIndexOf(':')
                const head = colon >= 0 ? key.slice(0, colon) : key
                const dev = colon >= 0 ? Number(key.slice(colon + 1)) : 0
                const underscore = head.indexOf('_')
                const cleaned = underscore >= 0 ? head.slice(0, underscore) : head
                const jid = cleaned.includes('@') ? cleaned : `${cleaned}@s.whatsapp.net`
                return { jid, device: dev, identityKey }
            })
        }
        if (snap.sessions.size > 0) {
            out.sessions = [...snap.sessions.values()].map(({ address, record }) => {
                const { jid, device: dev } = addrToJid(address)
                return { jid, device: dev, session: record.proto }
            })
        }
        if (snap.senderKeys.size > 0) {
            out.senderKeys = [...snap.senderKeys.values()].map(({ groupSender, record }) => {
                const { jid, device: dev } = addrToJid(groupSender.sender)
                return {
                    groupId: groupSender.groupId,
                    senderJid: jid,
                    senderDevice: dev,
                    record: record.proto
                }
            })
        }
        if (snap.appStateSyncKeys.size > 0) {
            out.appStateSyncKeys = [...snap.appStateSyncKeys.values()].map((k) => ({
                keyId: k.keyId,
                keyData: k.keyData,
                timestamp: k.timestamp ?? 0
            }))
        }
        if (snap.appStateVersions.size > 0) {
            out.appStateVersions = [...snap.appStateVersions.values()].map((v) => ({
                collection: v.collection,
                version: v.version,
                hash: v.hash,
                indexValueMap: Object.fromEntries(v.indexValueMap)
            }))
        }
        if (snap.privacyTokens.size > 0) {
            out.privacyTokens = [...snap.privacyTokens.values()]
                .filter((t): t is typeof t & { token: Uint8Array } => Boolean(t.token))
                .map((t) => ({
                    jid: t.jid,
                    token: t.token,
                    timestampMs: t.timestampMs ?? 0
                }))
        }
        if (snap.contacts.size > 0) {
            out.contacts = [...snap.contacts.values()].map((c) => ({
                jid: c.jid,
                ...(c.displayName ? { displayName: c.displayName } : {}),
                ...(c.pushName ? { pushName: c.pushName } : {}),
                ...(c.verifiedName ? { verifiedName: c.verifiedName } : {}),
                ...(c.lid ? { lid: c.lid } : {}),
                ...(c.phoneNumber ? { phoneNumber: c.phoneNumber } : {})
            }))
        }
        if (snap.deviceLists.size > 0) {
            out.deviceLists = [...snap.deviceLists.values()].map((dl) => {
                const deviceIds = dl.deviceJids.map((j) => {
                    const at = j.indexOf('@')
                    const head = at >= 0 ? j.slice(0, at) : j
                    const colon = head.lastIndexOf(':')
                    if (colon < 0) return 0
                    const n = Number(head.slice(colon + 1))
                    return Number.isFinite(n) ? n : 0
                })
                return {
                    userJid: dl.userJid,
                    deviceIds,
                    timestampMs: dl.updatedAtMs
                }
            })
        }
        if (snap.messageSecrets.size > 0) {
            out.messageSecrets = [...snap.messageSecrets.values()].map((s) => ({
                messageId: s.messageId,
                senderJid: s.senderJid,
                ...(s.chatJid ? { chatJid: s.chatJid } : {}),
                secret: s.secret
            }))
        }

        return out
    }
}

export type * from './types.js'
