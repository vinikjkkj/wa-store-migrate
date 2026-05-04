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

// libsignal keeps up to 5 historical sender-key states; the current sending
// state is the tail. zapo collapses to a single state, so older states are
// lost on round-trip — declared `lossy` for `senderKeys`.
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
        // Mutate so `signingPrivateKey?` stays optional (vs `| undefined`)
        // under exactOptionalPropertyTypes.
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
