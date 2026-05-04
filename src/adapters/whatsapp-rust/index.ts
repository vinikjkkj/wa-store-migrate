import { proto } from 'zapo-js/proto'

import type { AdapterCapabilities, IrDomain, StoreAdapter } from '@adapter'
import { normalizeWaJid, normalizeWaServer, parseLibsignalAddress } from '@codec/address'
import {
    emptySnapshot,
    type IrAddress,
    irAddressKey,
    type IrAppStateSyncKey,
    type IrDeviceList,
    type IrGroupSender,
    irGroupSenderKey,
    type IrIdentity,
    type IrLTHashState,
    type IrPreKey,
    type IrPrivacyToken,
    type IrSignedPreKey,
    type WaSnapshot
} from '@ir'

import { decodeRustHashState, encodeRustHashState } from './bincode.js'
import type {
    WhatsappRustAppStateMutationMacRow,
    WhatsappRustAppStateVersionRow,
    WhatsappRustDevice,
    WhatsappRustDeviceRegistryRow,
    WhatsappRustIdentityRow,
    WhatsappRustPreKeyRow,
    WhatsappRustSenderKeyRow,
    WhatsappRustSessionRow,
    WhatsappRustSnapshot,
    WhatsappRustTcTokenRow
} from './types.js'

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
    'deviceLists'
])

const WRITE: ReadonlySet<IrDomain> = READ

// `app_state_versions.state_data` is bincode `HashState`. We re-encode it
// from `(version, hash)` only — `index_value_map` rides in the separate
// `app_state_mutation_macs` table and rust never populates the in-struct
// map anyway. Flag the version+hash-only round-trip as lossy.
const LOSSY: ReadonlySet<IrDomain> = new Set<IrDomain>(['appStateVersions'])

const capabilities: AdapterCapabilities = { read: READ, write: WRITE, lossy: LOSSY }

// rust signal-address strings end in a literal `.0` suffix
// (`append_device_suffix` with `SIGNAL_DEVICE_ID = 0`). The actual device
// id sits inside the JID prefix, not in this suffix.
function stripRustDeviceSuffix(addr: string): string {
    return addr.endsWith('.0') ? addr.slice(0, -2) : addr
}

function rustAddrToIr(addr: string): IrAddress {
    return parseLibsignalAddress(`${stripRustDeviceSuffix(addr)}.0`)
}

function irAddrToRust(addr: IrAddress): string {
    const server = addr.server ?? 's.whatsapp.net'
    const dev = addr.device !== 0 ? `:${addr.device}` : ''
    return `${addr.user}${dev}@${server}.0`
}

function parseRustSenderAddress(addr: string): {
    groupId: string
    sender: IrAddress
} | null {
    // `<group_jid>:<sender_signal_address>.0` — the separator is the first
    // `:` after the group's `@<server>`.
    const at = addr.indexOf('@')
    if (at < 0) return null
    const sep = addr.indexOf(':', at)
    if (sep < 0) return null
    const groupId = normalizeWaJid(addr.slice(0, sep))
    const senderRaw = addr.slice(sep + 1)
    return { groupId, sender: rustAddrToIr(senderRaw) }
}

function composeRustSenderAddress(groupId: string, sender: IrAddress): string {
    return `${groupId}:${irAddrToRust(sender)}`
}

// rust packs the ADV signed identity into a single `AdvSignedDeviceIdentity`
// proto blob; the IR carries its four fields split.
function decodeAdvSignedDeviceIdentity(bytes: Uint8Array): {
    details?: Uint8Array
    accountSignatureKey?: Uint8Array
    accountSignature?: Uint8Array
    deviceSignature?: Uint8Array
} | null {
    try {
        const decoded = proto.ADVSignedDeviceIdentity.decode(bytes)
        const out: {
            details?: Uint8Array
            accountSignatureKey?: Uint8Array
            accountSignature?: Uint8Array
            deviceSignature?: Uint8Array
        } = {}
        if (decoded.details) out.details = decoded.details
        if (decoded.accountSignatureKey) out.accountSignatureKey = decoded.accountSignatureKey
        if (decoded.accountSignature) out.accountSignature = decoded.accountSignature
        if (decoded.deviceSignature) out.deviceSignature = decoded.deviceSignature
        return out
    } catch {
        return null
    }
}

function encodeAdvSignedDeviceIdentity(signedIdentity: {
    readonly details?: Uint8Array
    readonly accountSignatureKey?: Uint8Array
    readonly accountSignature?: Uint8Array
    readonly deviceSignature?: Uint8Array
}): Uint8Array {
    return proto.ADVSignedDeviceIdentity.encode(signedIdentity).finish()
}

function identityFromDevice(input: WhatsappRustSnapshot): IrIdentity {
    const d = input.device
    const decodedAccount = d.account ? decodeAdvSignedDeviceIdentity(d.account) : null
    return {
        noiseKeyPair: d.noiseKey,
        signedIdentityKeyPair: d.identityKey,
        registrationId: d.registrationId,
        advSecretKey: d.advSecretKey,
        ...(decodedAccount ? { signedIdentity: decodedAccount } : {}),
        ...(d.pn ? { meJid: normalizeWaJid(d.pn) } : {}),
        ...(d.lid ? { meLid: normalizeWaJid(d.lid) } : {}),
        ...(d.pushName ? { meDisplayName: d.pushName } : {}),
        platform: 'rust',
        ...(d.edgeRoutingInfo ? { routingInfo: d.edgeRoutingInfo } : {})
    }
}

function signedPreKey(input: WhatsappRustSnapshot): IrSignedPreKey {
    const d = input.device
    return {
        keyId: d.signedPreKeyId,
        keyPair: d.signedPreKey,
        signature: d.signedPreKeySignature,
        uploaded: true
    }
}

export const whatsappRustAdapter: StoreAdapter<WhatsappRustSnapshot, WhatsappRustSnapshot> = {
    id: 'whatsapp-rust',
    capabilities,
    toCanonical(input: WhatsappRustSnapshot): WaSnapshot {
        const snap = emptySnapshot('whatsapp-rust', identityFromDevice(input), signedPreKey(input))

        if (input.preKeys) {
            for (const k of input.preKeys) {
                const pre: IrPreKey = {
                    keyId: k.keyId,
                    keyPair: k.keyPair,
                    uploaded: k.uploaded
                }
                snap.preKeys.set(k.keyId, pre)
            }
        }

        if (input.identities) {
            for (const id of input.identities) {
                const addr = rustAddrToIr(id.address)
                snap.signalIdentities.set(irAddressKey(addr), id.key)
            }
        }

        if (input.sessions) {
            for (const s of input.sessions) {
                const addr = rustAddrToIr(s.address)
                snap.sessions.set(irAddressKey(addr), {
                    address: addr,
                    record: { proto: s.record }
                })
            }
        }

        if (input.senderKeys) {
            for (const sk of input.senderKeys) {
                const parsed = parseRustSenderAddress(sk.address)
                if (!parsed) continue
                const groupSender: IrGroupSender = {
                    groupId: parsed.groupId,
                    sender: parsed.sender
                }
                snap.senderKeys.set(irGroupSenderKey(groupSender), {
                    groupSender,
                    record: { proto: sk.record }
                })
            }
        }

        if (input.appStateKeys) {
            for (const k of input.appStateKeys) {
                const ir: IrAppStateSyncKey = {
                    keyId: k.keyId,
                    keyData: k.keyData
                }
                snap.appStateSyncKeys.set(Buffer.from(k.keyId).toString('base64'), ir)
            }
        }

        if (input.appStateVersions) {
            const macsByCollection = new Map<string, Map<string, Uint8Array>>()
            const versionByCollection = new Map<string, number>()
            for (const m of input.appStateMutationMacs ?? []) {
                let map = macsByCollection.get(m.name)
                if (!map) {
                    map = new Map()
                    macsByCollection.set(m.name, map)
                }
                map.set(Buffer.from(m.indexMac).toString('base64'), m.valueMac)
                const cur = versionByCollection.get(m.name) ?? 0
                if (m.version > cur) versionByCollection.set(m.name, m.version)
            }

            for (const v of input.appStateVersions) {
                const decoded = decodeRustHashState(v.stateData)
                const indexValueMap =
                    macsByCollection.get(v.name) ??
                    (decoded ? new Map(decoded.indexValueMap) : new Map())
                const ir: IrLTHashState = {
                    collection: v.name,
                    version: decoded?.version ?? versionByCollection.get(v.name) ?? 0,
                    hash: decoded?.hash ?? new Uint8Array(0),
                    indexValueMap
                }
                snap.appStateVersions.set(v.name, ir)
            }
        }

        if (input.tcTokens) {
            for (const t of input.tcTokens) {
                const jid = normalizeWaJid(t.jid)
                const ir: IrPrivacyToken = {
                    jid,
                    token: t.token,
                    timestampMs: t.tokenTimestamp * 1000,
                    ...(t.senderTimestamp !== undefined
                        ? { senderTimestampMs: t.senderTimestamp * 1000 }
                        : {})
                }
                snap.privacyTokens.set(jid, ir)
            }
        }

        if (input.deviceRegistry) {
            for (const dr of input.deviceRegistry) {
                const userJid = normalizeWaJid(dr.userJid)
                const at = userJid.indexOf('@')
                const user = at >= 0 ? userJid.slice(0, at) : userJid
                const server = at >= 0 ? userJid.slice(at + 1) : 's.whatsapp.net'
                let deviceIds: number[] = []
                try {
                    const arr = JSON.parse(dr.devicesJson) as Array<{ id?: number } | number>
                    deviceIds = arr.map((d) => (typeof d === 'number' ? d : (d?.id ?? 0)))
                } catch {
                    // malformed JSON — skip this row, leave deviceIds empty
                }
                const deviceJids = deviceIds.map((d) =>
                    d === 0 ? `${user}@${server}` : `${user}:${d}@${server}`
                )
                const ir: IrDeviceList = {
                    userJid,
                    deviceJids,
                    updatedAtMs: dr.timestamp * 1000
                }
                snap.deviceLists.set(userJid, ir)
            }
        }

        return snap
    },
    fromCanonical(snap: WaSnapshot): WhatsappRustSnapshot {
        const id = snap.identity
        const spk = snap.signedPreKey

        const device: WhatsappRustDevice = {
            registrationId: id.registrationId,
            noiseKey: id.noiseKeyPair,
            identityKey: id.signedIdentityKeyPair,
            signedPreKey: spk.keyPair,
            signedPreKeyId: spk.keyId,
            signedPreKeySignature: spk.signature,
            advSecretKey: id.advSecretKey.length === 32 ? id.advSecretKey : new Uint8Array(32),
            ...(id.signedIdentity
                ? { account: encodeAdvSignedDeviceIdentity(id.signedIdentity) }
                : {}),
            ...(id.meJid ? { pn: id.meJid } : {}),
            ...(id.meLid ? { lid: id.meLid } : {}),
            ...(id.meDisplayName ? { pushName: id.meDisplayName } : {}),
            ...(id.routingInfo ? { edgeRoutingInfo: id.routingInfo } : {})
        }

        const out: {
            -readonly [K in keyof WhatsappRustSnapshot]: WhatsappRustSnapshot[K] extends
                | readonly (infer U)[]
                | undefined
                ? U[]
                : WhatsappRustSnapshot[K]
        } = { device }

        if (snap.preKeys.size > 0) {
            out.preKeys = [...snap.preKeys.values()].map(
                (k): WhatsappRustPreKeyRow => ({
                    keyId: k.keyId,
                    keyPair: k.keyPair,
                    uploaded: k.uploaded ?? false
                })
            )
        }

        if (snap.signalIdentities.size > 0) {
            out.identities = [...snap.signalIdentities].map(
                ([key, identityKey]): WhatsappRustIdentityRow => {
                    // IR key shape `<user>[@<server>][_<agent>]:<device>`.
                    const colon = key.lastIndexOf(':')
                    const head = colon >= 0 ? key.slice(0, colon) : key
                    const dev = colon >= 0 ? Number(key.slice(colon + 1)) : 0
                    const underscore = head.indexOf('_')
                    const cleaned = underscore >= 0 ? head.slice(0, underscore) : head
                    const at = cleaned.indexOf('@')
                    const user = at >= 0 ? cleaned.slice(0, at) : cleaned
                    const server =
                        at >= 0
                            ? (normalizeWaServer(cleaned.slice(at + 1)) ?? 's.whatsapp.net')
                            : 's.whatsapp.net'
                    const address = irAddrToRust({ user, device: dev, server })
                    return { address, key: identityKey }
                }
            )
        }

        if (snap.sessions.size > 0) {
            out.sessions = [...snap.sessions.values()].map(
                ({ address, record }): WhatsappRustSessionRow => ({
                    address: irAddrToRust(address),
                    record: record.proto
                })
            )
        }

        if (snap.senderKeys.size > 0) {
            out.senderKeys = [...snap.senderKeys.values()].map(
                ({ groupSender, record }): WhatsappRustSenderKeyRow => ({
                    address: composeRustSenderAddress(groupSender.groupId, groupSender.sender),
                    record: record.proto
                })
            )
        }

        if (snap.appStateSyncKeys.size > 0) {
            out.appStateKeys = [...snap.appStateSyncKeys.values()].map((k) => ({
                keyId: k.keyId,
                keyData: k.keyData
            }))
        }

        if (snap.appStateVersions.size > 0) {
            // bincode `HashState` requires hash to be exactly 128 bytes;
            // pad/truncate when the IR carries a different size (e.g. a
            // wa-web migration before the first sync). The map field is
            // emitted empty — `app_state_mutation_macs` carries the entries.
            out.appStateVersions = [...snap.appStateVersions.values()].map(
                (v): WhatsappRustAppStateVersionRow => {
                    const hash =
                        v.hash.length === 128
                            ? v.hash
                            : (() => {
                                  const padded = new Uint8Array(128)
                                  padded.set(v.hash.slice(0, 128))
                                  return padded
                              })()
                    return {
                        name: v.collection,
                        stateData: encodeRustHashState({ version: v.version, hash })
                    }
                }
            )
            const macs: WhatsappRustAppStateMutationMacRow[] = []
            for (const v of snap.appStateVersions.values()) {
                for (const [indexMacB64, valueMac] of v.indexValueMap) {
                    macs.push({
                        name: v.collection,
                        version: v.version,
                        indexMac: Uint8Array.from(Buffer.from(indexMacB64, 'base64')),
                        valueMac
                    })
                }
            }
            if (macs.length > 0) out.appStateMutationMacs = macs
        }

        if (snap.privacyTokens.size > 0) {
            out.tcTokens = [...snap.privacyTokens.values()]
                .filter(
                    (t): t is typeof t & { token: Uint8Array } =>
                        t.token !== undefined && t.token.length > 0
                )
                .map(
                    (t): WhatsappRustTcTokenRow => ({
                        jid: t.jid,
                        token: t.token,
                        tokenTimestamp: Math.floor((t.timestampMs ?? 0) / 1000),
                        ...(t.senderTimestampMs !== undefined
                            ? { senderTimestamp: Math.floor(t.senderTimestampMs / 1000) }
                            : {})
                    })
                )
        }

        if (snap.deviceLists.size > 0) {
            out.deviceRegistry = [...snap.deviceLists.values()].map(
                (dl): WhatsappRustDeviceRegistryRow => {
                    const ids = dl.deviceJids.map((j) => {
                        const at = j.indexOf('@')
                        const head = at >= 0 ? j.slice(0, at) : j
                        const colon = head.lastIndexOf(':')
                        if (colon < 0) return 0
                        const n = Number(head.slice(colon + 1))
                        return Number.isFinite(n) ? n : 0
                    })
                    return {
                        userJid: dl.userJid,
                        devicesJson: JSON.stringify(ids.map((id) => ({ id }))),
                        timestamp: Math.floor(dl.updatedAtMs / 1000)
                    }
                }
            )
        }

        return out
    }
}

export type * from './types.js'
