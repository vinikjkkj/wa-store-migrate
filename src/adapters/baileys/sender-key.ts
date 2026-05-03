import { decodeSenderKeyRecord, encodeSenderKeyRecord } from 'zapo-js/signal'

import { asBytes } from '@codec/bytes'
import type { IrAddress } from '@ir/address'

import type { BaileysSerializedSenderKey } from './session-types.js'

function toZapoAddress(addr: IrAddress): { user: string; server?: string; device: number } {
    const out: { user: string; server?: string; device: number } = {
        user: addr.user,
        device: addr.device
    }
    if (addr.server) out.server = addr.server
    return out
}

/**
 * baileys' sender-key serialization is `SenderKeyStateStructure[]` (states[]).
 * libsignal keeps up to 5 historical states; the current sending state is the
 * tail (`states[states.length - 1]` — same as `getSenderKeyState()`). zapo's
 * `SenderKeyRecord` collapses to a single state, which is what we encode.
 *
 * Round-trip from baileys → IR → baileys keeps only that latest state. Older
 * states are dropped — capabilities declare this as `lossy` for sender-keys.
 */
export function baileysSenderKeyToProto(
    states: BaileysSerializedSenderKey,
    groupId: string,
    sender: IrAddress
): Uint8Array {
    if (states.length === 0) {
        throw new Error(`baileys sender-key ${groupId}: empty state array`)
    }
    const state = states[states.length - 1]!
    const idx = states.length - 1
    const field = `senderKeyStates[${idx}]`

    const record: Parameters<typeof encodeSenderKeyRecord>[0] = {
        groupId,
        sender: toZapoAddress(sender),
        keyId: state.senderKeyId,
        iteration: state.senderChainKey.iteration,
        chainKey: asBytes(state.senderChainKey.seed, `${field}.senderChainKey.seed`),
        signingPublicKey: asBytes(
            state.senderSigningKey.public,
            `${field}.senderSigningKey.public`
        ),
        unusedMessageKeys: state.senderMessageKeys.map((k, i) => ({
            iteration: k.iteration,
            seed: asBytes(k.seed, `${field}.senderMessageKeys[${i}].seed`)
        }))
    }

    if (state.senderSigningKey.private) {
        // Mutate (rather than spread) so the inferred type for `record` keeps
        // `signingPrivateKey?: Uint8Array` instead of `Uint8Array | undefined`,
        // which is the exactOptionalPropertyTypes-correct shape. We already
        // checked the source is truthy so `asBytes` (non-optional) is safe.
        ;(record as { signingPrivateKey?: Uint8Array }).signingPrivateKey = asBytes(
            state.senderSigningKey.private,
            `${field}.senderSigningKey.private`
        )
    }

    return encodeSenderKeyRecord(record)
}

interface DecodedSenderKey {
    keyId: number
    iteration: number
    chainKey: Uint8Array
    signingPublicKey: Uint8Array
    signingPrivateKey?: Uint8Array
    unusedMessageKeys?: ReadonlyArray<{ iteration: number; seed: Uint8Array }>
}

export function protoToBaileysSenderKey(
    proto: Uint8Array,
    groupId: string,
    sender: IrAddress
): BaileysSerializedSenderKey {
    const decoded = decodeSenderKeyRecord(proto, groupId, toZapoAddress(sender)) as DecodedSenderKey

    return [
        {
            senderKeyId: decoded.keyId,
            senderChainKey: { iteration: decoded.iteration, seed: decoded.chainKey },
            senderSigningKey: {
                public: decoded.signingPublicKey,
                ...(decoded.signingPrivateKey ? { private: decoded.signingPrivateKey } : {})
            },
            senderMessageKeys: (decoded.unusedMessageKeys ?? []).map((k) => ({
                iteration: k.iteration,
                seed: k.seed
            }))
        }
    ]
}
