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

    const sendChain = sendInfo
        ? {
              ratchetKey: { pubKey: ratchetPubKey, privKey: ratchetPrivKey },
              nextMsgIndex: sendInfo.chain.chainKey.counter,
              chainKey: asBytes(sendInfo.chain.chainKey.key, `${field}.sendChain.key`)
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

    const aliceBaseKey: Uint8Array | null =
        entry.indexInfo.baseKeyType === BASE_KEY_TYPE_OURS
            ? ensurePrefixed33(
                  asBytes(entry.indexInfo.baseKey, `${field}.indexInfo.baseKey`),
                  `${field}.indexInfo.baseKey`
              )
            : null

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

/**
 * Converts a baileys serialized session record into libsignal proto bytes
 * (the IR shape). Skipped/out-of-order message keys per chain are dropped
 * — they're stored as raw HKDF seeds in baileys but proto recv chains expect
 * pre-derived `{cipherKey, macKey, iv}` triples.
 */
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

    // SignalSessionRecord shape — encodeSignalSessionRecord expects this exact
    // structure (asserted via runtime checks in zapo-js).
    return encodeSignalSessionRecord({
        ...main,
        prevSessions: prev as never
    })
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
): BaileysSerializedSessionEntry {
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

    // libsignal-node convention: open session has `closed === -1`, prev sessions
    // carry the close timestamp. We don't have that timestamp from the proto,
    // so prev entries get `closed = options.closedAtMs ?? Date.now() - 1`.
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

    // The most recent received ratchet is the head of recvChains (proto order
    // is highest-index first per libsignal SessionStructure semantics). When
    // there's no receive chain (X3DH initiator before Bob's first reply) we
    // fall back to our own send ratchet, matching baileys' constructor.
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

/**
 * Inverse of {@link baileysSessionToProto}. Reconstructs the libsignal-node
 * `_sessions` shape from proto bytes. The `previous → closed` distinction is
 * lost (closed timestamps are not in the proto), so prev entries get
 * `closed: -1, used: 0` — baileys re-prunes them on next access.
 */
export function protoToBaileysSession(proto: Uint8Array): BaileysSerializedSessionRecord {
    const record = decodeSignalSessionRecord(proto) as DecodedSnapshot & {
        prevSessions: ReadonlyArray<DecodedSnapshot>
    }
    const _sessions: Record<string, BaileysSerializedSessionEntry> = {}

    const mainEntry = snapshotToBaileysEntry(record, { isOpen: true })
    const mainKey = toBase64(mainEntry.indexInfo.baseKey as Uint8Array)
    _sessions[mainKey] = mainEntry

    // libsignal-node prunes prev sessions older than 40s of inactivity; we
    // give them a stable close timestamp slightly older than `now` so the
    // ordering stays consistent across round-trips.
    const closedBase = Date.now() - 1
    for (let i = 0; i < record.prevSessions.length; i += 1) {
        const prev = record.prevSessions[i]!
        const entry = snapshotToBaileysEntry(prev, { isOpen: false, closedAtMs: closedBase - i })
        const key = toBase64(entry.indexInfo.baseKey as Uint8Array)
        if (!(key in _sessions)) _sessions[key] = entry
    }

    return { _sessions, version: 'v1' }
}
