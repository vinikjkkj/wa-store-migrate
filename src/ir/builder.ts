// Fluent builder for WaSnapshot — hides Map construction and key formatting
// (irAddressKey, irGroupSenderKey, base64 keying for byte-id maps) so callers
// only think about IR domain values.

import { type IrAddress, irAddressKey, type IrGroupSender, irGroupSenderKey } from './address.js'
import type { IrSenderKeyRecord, IrSessionRecord } from './session.js'
import {
    emptySnapshot,
    type IrAppStateSyncKey,
    type IrContact,
    type IrDeviceList,
    type IrIdentity,
    type IrLTHashState,
    type IrMessageSecret,
    type IrPreKey,
    type IrPrivacyToken,
    type IrSenderKeyDistribution,
    type IrSignedPreKey,
    type LibId,
    type WaSnapshot,
    type WaSnapshotMutable
} from './snapshot.js'

export interface BuildSnapshotInit {
    readonly source: LibId
    readonly identity: IrIdentity
    readonly signedPreKey: IrSignedPreKey
}

export class SnapshotBuilder {
    private readonly snap: WaSnapshotMutable

    constructor(init: BuildSnapshotInit) {
        this.snap = emptySnapshot(init.source, init.identity, init.signedPreKey)
    }

    addPreKey(preKey: IrPreKey): this {
        this.snap.preKeys.set(preKey.keyId, preKey)
        return this
    }

    addPreKeys(preKeys: Iterable<IrPreKey>): this {
        for (const k of preKeys) this.snap.preKeys.set(k.keyId, k)
        return this
    }

    addSignalIdentity(address: IrAddress, identityKey: Uint8Array): this {
        this.snap.signalIdentities.set(irAddressKey(address), identityKey)
        return this
    }

    addSession(address: IrAddress, record: IrSessionRecord): this {
        this.snap.sessions.set(irAddressKey(address), { address, record })
        return this
    }

    addSessions(entries: Iterable<{ address: IrAddress; record: IrSessionRecord }>): this {
        for (const e of entries) this.addSession(e.address, e.record)
        return this
    }

    addSenderKey(groupSender: IrGroupSender, record: IrSenderKeyRecord): this {
        this.snap.senderKeys.set(irGroupSenderKey(groupSender), { groupSender, record })
        return this
    }

    addSenderKeys(
        entries: Iterable<{ groupSender: IrGroupSender; record: IrSenderKeyRecord }>
    ): this {
        for (const e of entries) this.addSenderKey(e.groupSender, e.record)
        return this
    }

    addSenderKeyDistribution(distribution: IrSenderKeyDistribution): this {
        this.snap.senderKeyDistributions.set(
            irGroupSenderKey(distribution.groupSender),
            distribution
        )
        return this
    }

    addAppStateSyncKey(key: IrAppStateSyncKey): this {
        this.snap.appStateSyncKeys.set(Buffer.from(key.keyId).toString('base64'), key)
        return this
    }

    addAppStateVersion(state: IrLTHashState): this {
        this.snap.appStateVersions.set(state.collection, state)
        return this
    }

    addPrivacyToken(token: IrPrivacyToken): this {
        this.snap.privacyTokens.set(token.jid, token)
        return this
    }

    addDeviceList(list: IrDeviceList): this {
        this.snap.deviceLists.set(list.userJid, list)
        return this
    }

    addContact(contact: IrContact): this {
        this.snap.contacts.set(contact.jid, contact)
        return this
    }

    addMessageSecret(secret: IrMessageSecret): this {
        this.snap.messageSecrets.set(secret.messageId, secret)
        return this
    }

    build(): WaSnapshot {
        return this.snap
    }
}

export function buildSnapshot(init: BuildSnapshotInit): SnapshotBuilder {
    return new SnapshotBuilder(init)
}
