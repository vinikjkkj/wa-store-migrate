import type { AdapterCapabilities, IrDomain, StoreAdapter } from '@adapter'
import type { WaSnapshot } from '@ir'

import { zapoFromCanonical } from './from-canonical.js'
import { zapoToCanonical } from './to-canonical.js'
import type { ZapoStoreSnapshot } from './types.js'

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
    'deviceLists',
    'contacts',
    'messageSecrets'
])

const WRITE: ReadonlySet<IrDomain> = READ

const capabilities: AdapterCapabilities = { read: READ, write: WRITE }

export const zapoAdapter: StoreAdapter<ZapoStoreSnapshot, ZapoStoreSnapshot> = {
    id: 'zapo',
    capabilities,
    toCanonical(input: ZapoStoreSnapshot): WaSnapshot {
        return zapoToCanonical(input)
    },
    fromCanonical(snapshot: WaSnapshot): ZapoStoreSnapshot {
        return zapoFromCanonical(snapshot)
    }
}

export type {
    ZapoAppStateCollectionVersion,
    ZapoAppStateData,
    ZapoAppStateSyncKey,
    ZapoAuthCredentials,
    ZapoContact,
    ZapoDeviceListSnapshot,
    ZapoIdentity,
    ZapoKeyPair,
    ZapoMessageSecret,
    ZapoPreKeyRecord,
    ZapoPrivacyToken,
    ZapoRegistrationInfo,
    ZapoSenderKeyEntry,
    ZapoSessionEntry,
    ZapoSignalAddress,
    ZapoSignedDeviceIdentity,
    ZapoSignedPreKey,
    ZapoStoreSnapshot
} from './types.js'
