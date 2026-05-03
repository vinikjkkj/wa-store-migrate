import type { AdapterCapabilities, IrDomain, StoreAdapter } from '@adapter'
import type { WaSnapshot } from '@ir'

import { baileysFromCanonical } from './from-canonical.js'
import { baileysToCanonical } from './to-canonical.js'
import type { BaileysAuthSnapshot } from './types.js'

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
    'contacts'
])

const WRITE: ReadonlySet<IrDomain> = new Set<IrDomain>([
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

// Lossy: skipped/out-of-order message keys per chain are dropped on session
// conversion (baileys' raw HKDF seed format vs proto pre-derived triples).
// Sender-keys: baileys stores up to 5 historical states; we keep only the
// most recent (matching libsignal `getSenderKeyState`). privacyTokens lose
// sub-second precision on the timestamp round-trip.
const LOSSY: ReadonlySet<IrDomain> = new Set<IrDomain>(['sessions', 'senderKeys', 'privacyTokens'])

const capabilities: AdapterCapabilities = { read: READ, write: WRITE, lossy: LOSSY }

export const baileysAdapter: StoreAdapter<BaileysAuthSnapshot, BaileysAuthSnapshot> = {
    id: 'baileys',
    capabilities,
    toCanonical(input: BaileysAuthSnapshot): WaSnapshot {
        return baileysToCanonical(input)
    },
    fromCanonical(snapshot: WaSnapshot): BaileysAuthSnapshot {
        return baileysFromCanonical(snapshot)
    }
}

export type {
    BaileysADVSignedDeviceIdentity,
    BaileysAppStateSyncKeyData,
    BaileysAuthSnapshot,
    BaileysAuthenticationCreds,
    BaileysContact,
    BaileysKeyPair,
    BaileysLTHashState,
    BaileysSignalDataSet,
    BaileysSignalIdentity,
    BaileysSignedKeyPair,
    BaileysTcTokenEntry
} from './types.js'
