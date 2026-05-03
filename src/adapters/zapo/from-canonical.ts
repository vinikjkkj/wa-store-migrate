import { decodeSenderKeyRecord, decodeSignalSessionRecord } from 'zapo-js/signal'

import { parseLibsignalAddress } from '@codec/address'
import type { IrAddress, IrGroupSender, WaSnapshot } from '@ir'

import type {
    ZapoAppStateData,
    ZapoAuthCredentials,
    ZapoContact,
    ZapoDeviceListSnapshot,
    ZapoIdentity,
    ZapoMessageSecret,
    ZapoPreKeyRecord,
    ZapoPrivacyToken,
    ZapoSenderKeyEntry,
    ZapoSessionEntry,
    ZapoSignalAddress,
    ZapoStoreSnapshot
} from './types.js'

function fromIrAddress(a: IrAddress): ZapoSignalAddress {
    const out: { user: string; device: number; server?: string } = {
        user: a.user,
        device: a.device
    }
    if (a.server) out.server = a.server
    return out
}

function fromIrGroupSender(g: IrGroupSender): { groupId: string; sender: ZapoSignalAddress } {
    return { groupId: g.groupId, sender: fromIrAddress(g.sender) }
}

function parseAddrKey(key: string): ZapoSignalAddress {
    const addr = parseLibsignalAddress(key)
    return fromIrAddress(addr)
}

function credsFromSnapshot(snap: WaSnapshot): ZapoAuthCredentials {
    const id = snap.identity
    const spk = snap.signedPreKey
    const hasUploadedPreKeys = [...snap.preKeys.values()].some((k) => k.uploaded)
    return {
        noiseKeyPair: id.noiseKeyPair,
        registrationInfo: {
            registrationId: id.registrationId,
            identityKeyPair: id.signedIdentityKeyPair
        },
        signedPreKey: {
            keyId: spk.keyId,
            keyPair: spk.keyPair,
            signature: spk.signature,
            uploaded: spk.uploaded ?? true
        },
        advSecretKey: id.advSecretKey,
        ...(id.signedIdentity ? { signedIdentity: id.signedIdentity } : {}),
        ...(id.meJid ? { meJid: id.meJid } : {}),
        ...(id.meLid ? { meLid: id.meLid } : {}),
        ...(id.meDisplayName ? { meDisplayName: id.meDisplayName } : {}),
        ...(id.platform ? { platform: id.platform } : {}),
        ...(id.routingInfo ? { routingInfo: id.routingInfo } : {}),
        ...(id.accountCreationTs !== undefined ? { accountCreationTs: id.accountCreationTs } : {}),
        serverHasPreKeys: hasUploadedPreKeys
    }
}

export function zapoFromCanonical(snap: WaSnapshot): ZapoStoreSnapshot {
    const preKeys: ZapoPreKeyRecord[] = []
    for (const k of snap.preKeys.values()) {
        preKeys.push({
            keyId: k.keyId,
            keyPair: k.keyPair,
            ...(k.uploaded !== undefined ? { uploaded: k.uploaded } : {})
        })
    }

    const identities: ZapoIdentity[] = []
    for (const [key, identityKey] of snap.signalIdentities) {
        identities.push({ address: parseAddrKey(key), identityKey })
    }

    const sessions: ZapoSessionEntry[] = []
    for (const { address, record } of snap.sessions.values()) {
        sessions.push({
            address: fromIrAddress(address),
            record: decodeSignalSessionRecord(record.proto)
        })
    }

    const senderKeys: ZapoSenderKeyEntry[] = []
    for (const { groupSender, record } of snap.senderKeys.values()) {
        const { groupId, sender } = fromIrGroupSender(groupSender)
        const decoded = decodeSenderKeyRecord(record.proto, groupId, {
            user: groupSender.sender.user,
            ...(groupSender.sender.server ? { server: groupSender.sender.server } : {}),
            device: groupSender.sender.device
        })
        senderKeys.push({ groupId, sender, record: decoded })
    }

    const appState: ZapoAppStateData | undefined =
        snap.appStateSyncKeys.size > 0 || snap.appStateVersions.size > 0
            ? {
                  keys: [...snap.appStateSyncKeys.values()].map((k) => ({
                      keyId: k.keyId,
                      keyData: k.keyData,
                      timestamp: k.timestamp ?? 0,
                      ...(k.fingerprint ? { fingerprint: k.fingerprint } : {})
                  })),
                  collections: Object.fromEntries(
                      [...snap.appStateVersions].map(([collection, st]) => [
                          collection,
                          {
                              version: st.version,
                              hash: st.hash,
                              indexValueMap: Object.fromEntries(st.indexValueMap)
                          }
                      ])
                  )
              }
            : undefined

    const privacyTokens: ZapoPrivacyToken[] = []
    for (const t of snap.privacyTokens.values()) {
        privacyTokens.push({
            jid: t.jid,
            ...(t.token ? { tcToken: t.token } : {}),
            ...(t.timestampMs !== undefined ? { tcTokenTimestamp: t.timestampMs } : {}),
            ...(t.senderTimestampMs !== undefined
                ? { tcTokenSenderTimestamp: t.senderTimestampMs }
                : {}),
            ...(t.nctSalt ? { nctSalt: t.nctSalt } : {}),
            updatedAtMs: t.timestampMs ?? Date.now()
        })
    }

    const deviceLists: ZapoDeviceListSnapshot[] = []
    for (const dl of snap.deviceLists.values()) {
        deviceLists.push({
            userJid: dl.userJid,
            deviceJids: dl.deviceJids,
            updatedAtMs: dl.updatedAtMs
        })
    }

    const contacts: ZapoContact[] = []
    for (const c of snap.contacts.values()) {
        contacts.push({
            jid: c.jid,
            ...(c.displayName ? { displayName: c.displayName } : {}),
            ...(c.pushName ? { pushName: c.pushName } : {}),
            ...(c.lid ? { lid: c.lid } : {}),
            ...(c.phoneNumber ? { phoneNumber: c.phoneNumber } : {}),
            lastUpdatedMs: c.lastUpdatedMs ?? 0
        })
    }

    const messageSecrets: ZapoMessageSecret[] = []
    for (const m of snap.messageSecrets.values()) {
        messageSecrets.push({ messageId: m.messageId, senderJid: m.senderJid, secret: m.secret })
    }

    return {
        credentials: credsFromSnapshot(snap),
        ...(preKeys.length > 0 ? { preKeys } : {}),
        ...(identities.length > 0 ? { identities } : {}),
        ...(sessions.length > 0 ? { sessions } : {}),
        ...(senderKeys.length > 0 ? { senderKeys } : {}),
        ...(appState ? { appState } : {}),
        ...(privacyTokens.length > 0 ? { privacyTokens } : {}),
        ...(deviceLists.length > 0 ? { deviceLists } : {}),
        ...(contacts.length > 0 ? { contacts } : {}),
        ...(messageSecrets.length > 0 ? { messageSecrets } : {})
    }
}
