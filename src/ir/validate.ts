import type { WaSnapshot } from './snapshot.js'

// Structural-only invariants — catch migration shape/size bugs (wrong key
// length, swapped pub/priv, missing required fields). Not cryptographic.

export interface ValidationIssue {
    readonly path: string
    readonly message: string
}

const PUBKEY_SIZES: ReadonlySet<number> = new Set([32, 33])
const PRIVKEY_SIZE = 32
const SIGNATURE_SIZE = 64
const ADV_SECRET_SIZE = 32

function checkBytes(
    out: ValidationIssue[],
    path: string,
    bytes: Uint8Array | undefined,
    expectedLength: number | ReadonlySet<number>
): void {
    if (!bytes) {
        out.push({ path, message: 'missing required bytes field' })
        return
    }
    const expected = typeof expectedLength === 'number' ? expectedLength : null
    const ok =
        expected !== null
            ? bytes.length === expected
            : (expectedLength as ReadonlySet<number>).has(bytes.length)
    if (!ok) {
        const expectedStr =
            typeof expectedLength === 'number'
                ? String(expectedLength)
                : `one of ${[...expectedLength].join('/')}`
        out.push({
            path,
            message: `expected ${expectedStr}-byte payload, got ${bytes.length}`
        })
    }
}

export function validateSnapshot(snap: WaSnapshot): readonly ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const id = snap.identity

    checkBytes(issues, 'identity.noiseKeyPair.pubKey', id.noiseKeyPair.pubKey, PUBKEY_SIZES)
    checkBytes(issues, 'identity.noiseKeyPair.privKey', id.noiseKeyPair.privKey, PRIVKEY_SIZE)
    checkBytes(
        issues,
        'identity.signedIdentityKeyPair.pubKey',
        id.signedIdentityKeyPair.pubKey,
        PUBKEY_SIZES
    )
    checkBytes(
        issues,
        'identity.signedIdentityKeyPair.privKey',
        id.signedIdentityKeyPair.privKey,
        PRIVKEY_SIZE
    )
    // wa-web wipes advSecretKey after the initial pair-success
    // (clearADVSecretKey in WAWebCompanionRegUtils) — empty is legitimate.
    if (id.advSecretKey && id.advSecretKey.length !== 0) {
        checkBytes(issues, 'identity.advSecretKey', id.advSecretKey, ADV_SECRET_SIZE)
    }

    if (
        !Number.isInteger(id.registrationId) ||
        id.registrationId < 0 ||
        id.registrationId > 0x3fff
    ) {
        issues.push({
            path: 'identity.registrationId',
            message: `expected 14-bit unsigned integer, got ${id.registrationId}`
        })
    }

    const spk = snap.signedPreKey
    checkBytes(issues, 'signedPreKey.keyPair.pubKey', spk.keyPair.pubKey, PUBKEY_SIZES)
    checkBytes(issues, 'signedPreKey.keyPair.privKey', spk.keyPair.privKey, PRIVKEY_SIZE)
    checkBytes(issues, 'signedPreKey.signature', spk.signature, SIGNATURE_SIZE)
    if (!Number.isInteger(spk.keyId) || spk.keyId < 0) {
        issues.push({
            path: 'signedPreKey.keyId',
            message: `expected non-negative integer, got ${spk.keyId}`
        })
    }

    for (const [keyId, k] of snap.preKeys) {
        const p = `preKeys[${keyId}]`
        if (k.keyId !== keyId) {
            issues.push({
                path: `${p}.keyId`,
                message: `map key (${keyId}) does not match record keyId (${k.keyId})`
            })
        }
        checkBytes(issues, `${p}.keyPair.pubKey`, k.keyPair.pubKey, PUBKEY_SIZES)
        checkBytes(issues, `${p}.keyPair.privKey`, k.keyPair.privKey, PRIVKEY_SIZE)
    }

    for (const [k, identityKey] of snap.signalIdentities) {
        checkBytes(issues, `signalIdentities[${k}]`, identityKey, PUBKEY_SIZES)
    }

    for (const [k, { record }] of snap.sessions) {
        if (!(record.proto instanceof Uint8Array) || record.proto.length === 0) {
            issues.push({
                path: `sessions[${k}].record.proto`,
                message: 'expected non-empty Uint8Array'
            })
        }
    }

    for (const [k, { record }] of snap.senderKeys) {
        if (!(record.proto instanceof Uint8Array) || record.proto.length === 0) {
            issues.push({
                path: `senderKeys[${k}].record.proto`,
                message: 'expected non-empty Uint8Array'
            })
        }
    }

    for (const [k, lt] of snap.appStateVersions) {
        if (!(lt.hash instanceof Uint8Array) || lt.hash.length !== 128) {
            issues.push({
                path: `appStateVersions[${k}].hash`,
                message: `expected 128-byte LT-hash, got ${lt.hash?.length ?? 'undefined'}`
            })
        }
    }

    return issues
}

export class SnapshotValidationError extends Error {
    public readonly issues: readonly ValidationIssue[]
    constructor(issues: readonly ValidationIssue[]) {
        const summary =
            issues.length > 5
                ? `${issues.length} issues`
                : issues.map((i) => `${i.path}: ${i.message}`).join('; ')
        super(`WaSnapshot failed validation: ${summary}`)
        this.name = 'SnapshotValidationError'
        this.issues = issues
    }
}

export function assertValidSnapshot(snap: WaSnapshot): void {
    const issues = validateSnapshot(snap)
    if (issues.length > 0) throw new SnapshotValidationError(issues)
}
