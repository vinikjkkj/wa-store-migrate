import { decodeSignalSessionRecord, encodeSignalSessionRecord } from 'zapo-js/signal'

import {
    asBytes,
    asOptionalBytes,
    ensurePrefixed33,
    fromBase64,
    stripPrefix33,
    toBase64
} from '@codec/bytes'

import type {
    BaileysCurrentRatchet,
    BaileysIndexInfo,
    BaileysSerializedSessionEntry,
    BaileysSerializedSessionRecord
} from './session-types.js'

const CHAIN_TYPE_SENDING = 1
const CHAIN_TYPE_RECEIVING = 2
const BASE_KEY_TYPE_OURS = 1
const BASE_KEY_TYPE_THEIRS = 2

export interface BaileysSessionLocal {
    readonly regId: number
    readonly identityPubKey: Uint8Array // 32 or 33 bytes
}

function pickCurrentEntry(
    sessions: BaileysSerializedSessionRecord['_sessions']
): { key: string; entry: BaileysSerializedSessionEntry } | null {
    const entries = Object.entries(sessions)
    if (entries.length === 0) return null
    let openKey: string | null = null
    let openEntry: BaileysSerializedSessionEntry | null = null
    let fallbackKey: string | null = null
    let fallbackEntry: BaileysSerializedSessionEntry | null = null
    let fallbackUsed = -1
    for (const [k, e] of entries) {
        if (e.indexInfo.closed === -1 && openEntry === null) {
            openKey = k
            openEntry = e
        }
        const used = e.indexInfo.used ?? 0
        if (used >= fallbackUsed) {
            fallbackKey = k
            fallbackEntry = e
            fallbackUsed = used
        }
    }
    if (openKey !== null && openEntry !== null) return { key: openKey, entry: openEntry }
    if (fallbackKey !== null && fallbackEntry !== null)
        return { key: fallbackKey, entry: fallbackEntry }
    return null
}

function findSendChain(
    entry: BaileysSerializedSessionEntry,
    ratchetPubKeyBytes: Uint8Array
): { key: string; chain: BaileysSerializedSessionEntry['_chains'][string] } | null {
    const expected = toBase64(ratchetPubKeyBytes)
    const direct = entry._chains[expected]
    if (direct) return { key: expected, chain: direct }
    for (const k of Object.keys(entry._chains)) {
        const c = entry._chains[k]
        if (c && c.chainType === CHAIN_TYPE_SENDING) return { key: k, chain: c }
    }
    return null
}

function buildSnapshot(
    entry: BaileysSerializedSessionEntry,
    local: BaileysSessionLocal,
    field: string
): {
    local: { regId: number; pubKey: Uint8Array }
    remote: { regId: number; pubKey: Uint8Array }
    rootKey: Uint8Array
    sendChain: {
        ratchetKey: { pubKey: Uint8Array; privKey: Uint8Array }
        nextMsgIndex: number
        chainKey: Uint8Array
    }
    recvChains: ReadonlyArray<{
        senderRatchetKey?: Uint8Array
        chainKey?: { index: number; key: Uint8Array }
        messageKeys: never[]
    }>
    initialExchangeInfo: {
        remoteOneTimeId: number | null
        remoteSignedId: number
        localOneTimePubKey: Uint8Array
    } | null
    prevSendChainHighestIndex: number
    aliceBaseKey: Uint8Array | null
} {
    const ratchetPubKey = ensurePrefixed33(
        asBytes(entry.currentRatchet.ephemeralKeyPair.pubKey, `${field}.currentRatchet.pubKey`),
        `${field}.currentRatchet.pubKey`
    )
    const ratchetPrivKey = asBytes(
        entry.currentRatchet.ephemeralKeyPair.privKey,
        `${field}.currentRatchet.privKey`
    )
    const sendInfo = findSendChain(entry, ratchetPubKey)
    const sendChainKey = sendInfo?.key ?? null
    const remotePubKey = ensurePrefixed33(
        asBytes(entry.indexInfo.remoteIdentityKey, `${field}.indexInfo.remoteIdentityKey`),
        `${field}.indexInfo.remoteIdentityKey`
    )
    const localPubKey = ensurePrefixed33(local.identityPubKey, 'local.identityPubKey')

    const sendKeyMaterial = sendInfo?.chain.chainKey
    const sendChain =
        sendInfo && sendKeyMaterial?.key !== undefined && sendKeyMaterial?.key !== null
            ? {
                  ratchetKey: { pubKey: ratchetPubKey, privKey: ratchetPrivKey },
                  nextMsgIndex: sendKeyMaterial.counter,
                  chainKey: asBytes(sendKeyMaterial.key, `${field}.sendChain.key`)
              }
            : {
                  ratchetKey: { pubKey: ratchetPubKey, privKey: ratchetPrivKey },
                  nextMsgIndex: 0,
                  chainKey: new Uint8Array(32)
              }

    const recvChains: Array<{
        senderRatchetKey?: Uint8Array
        chainKey?: { index: number; key: Uint8Array }
        messageKeys: never[]
    }> = []
    for (const k of Object.keys(entry._chains)) {
        if (k === sendChainKey) continue
        const chain = entry._chains[k]
        if (!chain || chain.chainType === CHAIN_TYPE_SENDING) continue
        // libsignal-node clears `chainKey.key` after ratchet step — the slot
        // stays for recognition but carries no usable crypto material.
        if (chain.chainKey?.key === undefined || chain.chainKey?.key === null) continue
        const ratchet = ensurePrefixed33(fromBase64(k), `recvChain[${k}].senderRatchetKey`)
        recvChains.push({
            senderRatchetKey: ratchet,
            chainKey: {
                index: chain.chainKey.counter,
                key: asBytes(chain.chainKey.key, `recvChain[${k}].chainKey.key`)
            },
            messageKeys: []
        })
    }

    // The proto's `aliceBaseKey` field stores the X3DH initiator's base
    // key regardless of role — both sides know it. go.mau.fi/libsignal
    // requires it populated on both ends.
    const aliceBaseKey: Uint8Array = ensurePrefixed33(
        asBytes(entry.indexInfo.baseKey, `${field}.indexInfo.baseKey`),
        `${field}.indexInfo.baseKey`
    )

    const initialExchangeInfo = entry.pendingPreKey
        ? {
              remoteOneTimeId: entry.pendingPreKey.preKeyId ?? null,
              remoteSignedId: entry.pendingPreKey.signedKeyId,
              localOneTimePubKey: ensurePrefixed33(
                  asBytes(entry.pendingPreKey.baseKey, `${field}.pendingPreKey.baseKey`),
                  `${field}.pendingPreKey.baseKey`
              )
          }
        : null

    return {
        local: { regId: local.regId, pubKey: localPubKey },
        remote: { regId: entry.registrationId, pubKey: remotePubKey },
        rootKey: asBytes(entry.currentRatchet.rootKey, `${field}.currentRatchet.rootKey`),
        sendChain,
        recvChains,
        initialExchangeInfo,
        prevSendChainHighestIndex: entry.currentRatchet.previousCounter,
        aliceBaseKey
    }
}

// Skipped/out-of-order message keys per chain are dropped on the way out
// — baileys stores them as raw HKDF seeds, proto expects pre-derived
// `{cipherKey, macKey, iv}` triples.
export function baileysSessionToProto(
    serialized: BaileysSerializedSessionRecord,
    local: BaileysSessionLocal
): Uint8Array {
    const current = pickCurrentEntry(serialized._sessions)
    if (!current) throw new Error('baileys session: empty _sessions')

    const main = buildSnapshot(current.entry, local, 'currentSession')
    const prev = []
    for (const k of Object.keys(serialized._sessions)) {
        if (k === current.key) continue
        const entry = serialized._sessions[k]
        if (!entry) continue
        prev.push(buildSnapshot(entry, local, `prevSession[${k}]`))
    }

    return encodeSignalSessionRecord({ ...main, prevSessions: prev as never })
}

interface DecodedSnapshot {
    local: { regId: number; pubKey: Uint8Array }
    remote: { regId: number; pubKey: Uint8Array }
    rootKey: Uint8Array
    sendChain: {
        ratchetKey: { pubKey: Uint8Array; privKey: Uint8Array }
        nextMsgIndex: number
        chainKey: Uint8Array
    }
    recvChains: ReadonlyArray<{
        senderRatchetKey?: Uint8Array
        chainKey?: { index?: number; key?: Uint8Array }
    }>
    initialExchangeInfo: {
        remoteOneTimeId: number | null
        remoteSignedId: number
        localOneTimePubKey: Uint8Array
    } | null
    prevSendChainHighestIndex: number
    aliceBaseKey: Uint8Array | null
}

function snapshotToBaileysEntry(
    snap: DecodedSnapshot,
    options: { isOpen: boolean; closedAtMs?: number }
): BaileysSerializedSessionEntry | null {
    // baileys can't represent a session without a populated sendChain.
    if (!snap?.sendChain?.ratchetKey?.pubKey || !snap.sendChain.ratchetKey.privKey) {
        return null
    }
    const ratchetPub = stripPrefix33(
        snap.sendChain.ratchetKey.pubKey,
        'sendChain.ratchetKey.pubKey'
    )
    const sendKeyB64 = toBase64(
        asOptionalBytes(snap.sendChain.ratchetKey.pubKey, 'sendChain.ratchetKey.pubKey')!
    )

    const chains: Record<
        string,
        {
            chainKey: { counter: number; key: Uint8Array }
            chainType: number
            messageKeys: Record<string, never>
        }
    > = {}
    chains[sendKeyB64] = {
        chainKey: { counter: snap.sendChain.nextMsgIndex, key: snap.sendChain.chainKey },
        chainType: CHAIN_TYPE_SENDING,
        messageKeys: {}
    }

    for (const r of snap.recvChains) {
        if (!r.senderRatchetKey || !r.chainKey?.key) continue
        const ratchet = r.senderRatchetKey
        const k = toBase64(ratchet)
        chains[k] = {
            chainKey: { counter: r.chainKey.index ?? 0, key: r.chainKey.key },
            chainType: CHAIN_TYPE_RECEIVING,
            messageKeys: {}
        }
    }

    const baseKey =
        snap.aliceBaseKey ??
        stripPrefix33(snap.remote.pubKey, 'remote.pubKey (used as baseKey fallback)')
    const baseKeyType = snap.aliceBaseKey ? BASE_KEY_TYPE_OURS : BASE_KEY_TYPE_THEIRS

    // libsignal-node convention: open = `closed === -1`, prev = close ts.
    // The proto doesn't carry the close ts, so prev entries get a fresh one.
    const now = Date.now()
    const closed = options.isOpen ? -1 : (options.closedAtMs ?? now - 1)

    const indexInfo: BaileysIndexInfo = {
        baseKey,
        baseKeyType,
        closed,
        used: options.isOpen ? now : closed,
        created: options.isOpen ? now : closed,
        remoteIdentityKey: snap.remote.pubKey
    }

    // recvChains[0] is the most recent ratchet (proto order is highest-first).
    // Fall back to our send ratchet for X3DH initiators before Bob's reply —
    // matches baileys' own constructor.
    const lastRemote = snap.recvChains[0]?.senderRatchetKey ?? ratchetPub

    const currentRatchet: BaileysCurrentRatchet = {
        ephemeralKeyPair: {
            pubKey: snap.sendChain.ratchetKey.pubKey,
            privKey: snap.sendChain.ratchetKey.privKey
        },
        lastRemoteEphemeralKey: lastRemote,
        previousCounter: snap.prevSendChainHighestIndex,
        rootKey: snap.rootKey
    }

    const entry: BaileysSerializedSessionEntry = {
        registrationId: snap.remote.regId,
        currentRatchet,
        indexInfo,
        _chains: chains,
        ...(snap.initialExchangeInfo
            ? {
                  pendingPreKey: {
                      ...(snap.initialExchangeInfo.remoteOneTimeId !== null &&
                      snap.initialExchangeInfo.remoteOneTimeId !== undefined
                          ? { preKeyId: snap.initialExchangeInfo.remoteOneTimeId }
                          : {}),
                      signedKeyId: snap.initialExchangeInfo.remoteSignedId,
                      baseKey: snap.initialExchangeInfo.localOneTimePubKey
                  }
              }
            : {})
    }
    return entry
}

// Empty `_sessions` is a legitimate result — the next PreKey message
// rebuilds the session. Prev entries get fabricated close timestamps
// (the proto doesn't carry them); libsignal-node re-prunes on access.
export function protoToBaileysSession(proto: Uint8Array): BaileysSerializedSessionRecord {
    const record = decodeSignalSessionRecord(proto) as DecodedSnapshot & {
        prevSessions: ReadonlyArray<DecodedSnapshot>
    }
    const _sessions: Record<string, BaileysSerializedSessionEntry> = {}

    const mainEntry = snapshotToBaileysEntry(record, { isOpen: true })
    if (!mainEntry) return { _sessions, version: 'v1' }
    const mainKey = toBase64(mainEntry.indexInfo.baseKey as Uint8Array)
    _sessions[mainKey] = mainEntry

    const closedBase = Date.now() - 1
    for (let i = 0; i < record.prevSessions.length; i += 1) {
        const prev = record.prevSessions[i]!
        const entry = snapshotToBaileysEntry(prev, { isOpen: false, closedAtMs: closedBase - i })
        if (!entry) continue
        const key = toBase64(entry.indexInfo.baseKey as Uint8Array)
        if (!(key in _sessions)) _sessions[key] = entry
    }

    return { _sessions, version: 'v1' }
}
