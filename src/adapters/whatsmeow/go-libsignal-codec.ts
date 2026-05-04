import { proto } from 'zapo-js/proto'

/**
 * Codec for `go.mau.fi/libsignal`'s JSON form (whatsmeow persistence).
 * The wire is `json.Marshal` over Go's libsignal structs — exported
 * (capitalized) field names, since the structs carry no `json:"..."` tags.
 * Validated against `go.mau.fi/libsignal@v0.2.1`.
 *
 *   proto SessionStructure (LocalStorageProtocol.proto)   →   Go state/record.StateStructure
 *   ──────────────────────────────────────────────────       ──────────────────────────────────
 *   sessionVersion                                            SessionVersion
 *   localIdentityPublic                                       LocalIdentityPublic
 *   remoteIdentityPublic                                      RemoteIdentityPublic
 *   rootKey                                                   RootKey
 *   previousCounter                                           PreviousCounter
 *   senderChain                                               SenderChain
 *   receiverChains                                            ReceiverChains
 *   pendingPreKey { preKeyId, signedPreKeyId, baseKey }       PendingPreKey { PreKeyID*, SignedPreKeyID, BaseKey }
 *   localRegistrationId                                       LocalRegistrationID
 *   remoteRegistrationId                                      RemoteRegistrationID
 *   aliceBaseKey                                              SenderBaseKey   ← rename
 *
 *   proto Chain                                              Go state/record.ChainStructure
 *   ──────────────────────────                              ────────────────────────────
 *   senderRatchetKey                                         SenderRatchetKeyPublic
 *   senderRatchetKeyPrivate                                  SenderRatchetKeyPrivate
 *   chainKey { key, index }                                  ChainKey { Key, Index }
 *   messageKeys [{ index, cipherKey, macKey, iv }]           MessageKeys [{ CipherKey, MacKey, IV, Index }]
 *
 *   proto SenderKeyRecordStructure                           Go SenderKeyStructure
 *   ───────────────────────────────                          ─────────────────────
 *   senderKeyStates                                          SenderKeyStates
 *
 *   proto SenderKeyStateStructure                            Go SenderKeyStateStructure
 *   ──────────────────────────────                          ──────────────────────────────
 *   senderKeyId                                              KeyID
 *   senderChainKey { iteration, seed }                       SenderChainKey { Iteration, ChainKey }
 *   senderSigningKey { public, private }                     SigningKeyPublic, SigningKeyPrivate (flat)
 *   senderMessageKeys [{ iteration, seed }]                  Keys [{ Iteration, IV, CipherKey, Seed }]
 */

const RecordStructure = proto.RecordStructure
const SenderKeyRecordStructure = proto.SenderKeyRecordStructure

function b64(bytes: Uint8Array | undefined | null): string | null {
    if (bytes === undefined || bytes === null) return null
    return Buffer.from(bytes).toString('base64')
}

function fromB64(s: string | null | undefined): Uint8Array {
    if (!s) return new Uint8Array(0)
    return new Uint8Array(Buffer.from(s, 'base64'))
}

interface GoChainKey {
    Key: string | null
    Index: number
}

interface GoMessageKey {
    CipherKey: string | null
    MacKey: string | null
    IV: string | null
    Index: number
}

interface GoChain {
    SenderRatchetKeyPublic: string | null
    SenderRatchetKeyPrivate: string | null
    ChainKey: GoChainKey | null
    MessageKeys: GoMessageKey[] | null
}

interface GoOptionalUint32 {
    Value: number
    IsEmpty: boolean
}

interface GoPendingPreKey {
    PreKeyID: GoOptionalUint32 | null
    SignedPreKeyID: number
    BaseKey: string | null
}

interface GoStateStructure {
    LocalIdentityPublic: string | null
    LocalRegistrationID: number
    NeedsRefresh: boolean
    PendingKeyExchange: null
    PendingPreKey: GoPendingPreKey | null
    PreviousCounter: number
    ReceiverChains: GoChain[]
    RemoteIdentityPublic: string | null
    RemoteRegistrationID: number
    RootKey: string | null
    SenderBaseKey: string | null
    SenderChain: GoChain | null
    SessionVersion: number
}

interface GoSessionStructure {
    SessionState: GoStateStructure
    PreviousStates: GoStateStructure[] | null
}

interface GoSenderMessageKey {
    Iteration: number
    IV: string | null
    CipherKey: string | null
    Seed: string | null
}

interface GoSenderChainKey {
    Iteration: number
    ChainKey: string | null
}

interface GoSenderKeyState {
    Keys: GoSenderMessageKey[] | null
    KeyID: number
    SenderChainKey: GoSenderChainKey | null
    SigningKeyPrivate: string | null
    SigningKeyPublic: string | null
}

interface GoSenderKeyStructure {
    SenderKeyStates: GoSenderKeyState[]
}

function chainProtoToGo(c: unknown): GoChain {
    const x = c as {
        senderRatchetKey?: Uint8Array
        senderRatchetKeyPrivate?: Uint8Array
        chainKey?: { key?: Uint8Array; index?: number }
        messageKeys?: Array<{
            index?: number
            cipherKey?: Uint8Array
            macKey?: Uint8Array
            iv?: Uint8Array
        }>
    }
    return {
        SenderRatchetKeyPublic: b64(x.senderRatchetKey),
        SenderRatchetKeyPrivate: b64(x.senderRatchetKeyPrivate),
        ChainKey: x.chainKey ? { Key: b64(x.chainKey.key), Index: x.chainKey.index ?? 0 } : null,
        MessageKeys:
            (x.messageKeys ?? []).map((m) => ({
                CipherKey: b64(m.cipherKey),
                MacKey: b64(m.macKey),
                IV: b64(m.iv),
                Index: m.index ?? 0
            })) ?? []
    }
}

function chainGoToProto(c: GoChain | null | undefined): unknown {
    if (!c) return undefined
    return {
        senderRatchetKey: fromB64(c.SenderRatchetKeyPublic),
        senderRatchetKeyPrivate: fromB64(c.SenderRatchetKeyPrivate),
        chainKey: c.ChainKey
            ? { key: fromB64(c.ChainKey.Key), index: c.ChainKey.Index }
            : undefined,
        messageKeys: (c.MessageKeys ?? []).map((m) => ({
            index: m.Index,
            cipherKey: fromB64(m.CipherKey),
            macKey: fromB64(m.MacKey),
            iv: fromB64(m.IV)
        }))
    }
}

interface ProtoSessionState {
    sessionVersion?: number
    localIdentityPublic?: Uint8Array
    remoteIdentityPublic?: Uint8Array
    rootKey?: Uint8Array
    previousCounter?: number
    senderChain?: unknown
    receiverChains?: unknown[]
    pendingPreKey?: { preKeyId?: number; signedPreKeyId?: number; baseKey?: Uint8Array }
    remoteRegistrationId?: number
    localRegistrationId?: number
    aliceBaseKey?: Uint8Array
}

function protoStateToGo(p: ProtoSessionState): GoStateStructure {
    return {
        LocalIdentityPublic: b64(p.localIdentityPublic),
        LocalRegistrationID: p.localRegistrationId ?? 0,
        NeedsRefresh: false,
        PendingKeyExchange: null,
        PendingPreKey: p.pendingPreKey
            ? {
                  PreKeyID:
                      p.pendingPreKey.preKeyId !== undefined
                          ? { Value: p.pendingPreKey.preKeyId, IsEmpty: false }
                          : null,
                  SignedPreKeyID: p.pendingPreKey.signedPreKeyId ?? 0,
                  BaseKey: b64(p.pendingPreKey.baseKey)
              }
            : null,
        PreviousCounter: p.previousCounter ?? 0,
        ReceiverChains: (p.receiverChains ?? []).map(chainProtoToGo),
        RemoteIdentityPublic: b64(p.remoteIdentityPublic),
        RemoteRegistrationID: p.remoteRegistrationId ?? 0,
        RootKey: b64(p.rootKey),
        SenderBaseKey: b64(p.aliceBaseKey),
        SenderChain: p.senderChain ? chainProtoToGo(p.senderChain) : null,
        SessionVersion: p.sessionVersion ?? 3
    }
}

function goStateToProto(s: GoStateStructure): Record<string, unknown> {
    const pendingPreKey = s.PendingPreKey
        ? {
              ...(s.PendingPreKey.PreKeyID && !s.PendingPreKey.PreKeyID.IsEmpty
                  ? { preKeyId: s.PendingPreKey.PreKeyID.Value }
                  : {}),
              signedPreKeyId: s.PendingPreKey.SignedPreKeyID,
              baseKey: fromB64(s.PendingPreKey.BaseKey)
          }
        : undefined

    return {
        sessionVersion: s.SessionVersion,
        localIdentityPublic: fromB64(s.LocalIdentityPublic),
        remoteIdentityPublic: fromB64(s.RemoteIdentityPublic),
        rootKey: fromB64(s.RootKey),
        previousCounter: s.PreviousCounter,
        senderChain: chainGoToProto(s.SenderChain),
        receiverChains: (s.ReceiverChains ?? []).map(chainGoToProto),
        ...(pendingPreKey ? { pendingPreKey } : {}),
        remoteRegistrationId: s.RemoteRegistrationID,
        localRegistrationId: s.LocalRegistrationID,
        aliceBaseKey: fromB64(s.SenderBaseKey)
    }
}

/**
 * IR session proto bytes → whatsmeow JSON bytes (UTF-8). The IR carries
 * `proto.RecordStructure { currentSession, previousSessions }` (zapo's
 * libsignal wrapper); whatsmeow's Go libsignal serializes the equivalent
 * `record.SessionRecord { SessionState, PreviousStates }` to JSON.
 */
export function protoToWhatsmeowSessionJson(protoBytes: Uint8Array): Uint8Array {
    const decoded = RecordStructure.decode(protoBytes) as unknown as {
        currentSession?: ProtoSessionState
        previousSessions?: ProtoSessionState[]
    }
    if (!decoded.currentSession) {
        throw new Error('whatsmeow session: IR record has no currentSession')
    }
    const out: GoSessionStructure = {
        SessionState: protoStateToGo(decoded.currentSession),
        PreviousStates: (decoded.previousSessions ?? []).map(protoStateToGo)
    }
    return Buffer.from(JSON.stringify(out), 'utf-8')
}

/** whatsmeow JSON bytes → IR session proto bytes (proto.RecordStructure). */
export function whatsmeowSessionJsonToProto(jsonBytes: Uint8Array): Uint8Array {
    const text = Buffer.from(jsonBytes).toString('utf-8')
    const obj = JSON.parse(text) as GoSessionStructure
    const recordMsg = {
        currentSession: goStateToProto(obj.SessionState),
        previousSessions: (obj.PreviousStates ?? []).map(goStateToProto)
    }
    return RecordStructure.encode(recordMsg).finish() as Uint8Array
}

/** IR sender-key proto bytes → whatsmeow JSON bytes (UTF-8). */
export function protoToWhatsmeowSenderKeyJson(protoBytes: Uint8Array): Uint8Array {
    const p = SenderKeyRecordStructure.decode(protoBytes) as unknown as {
        senderKeyStates?: Array<{
            senderKeyId?: number
            senderChainKey?: { iteration?: number; seed?: Uint8Array }
            senderSigningKey?: { public?: Uint8Array; private?: Uint8Array }
            senderMessageKeys?: Array<{ iteration?: number; seed?: Uint8Array }>
        }>
    }

    const out: GoSenderKeyStructure = {
        SenderKeyStates: (p.senderKeyStates ?? []).map((s) => ({
            // proto carries only `iteration` + `seed`; IV/CipherKey are
            // re-derived from Seed via HKDF on demand by the consumer.
            Keys: (s.senderMessageKeys ?? []).map((k) => ({
                Iteration: k.iteration ?? 0,
                IV: null,
                CipherKey: null,
                Seed: b64(k.seed)
            })),
            KeyID: s.senderKeyId ?? 0,
            SenderChainKey: s.senderChainKey
                ? {
                      Iteration: s.senderChainKey.iteration ?? 0,
                      ChainKey: b64(s.senderChainKey.seed)
                  }
                : null,
            SigningKeyPrivate: b64(s.senderSigningKey?.private),
            SigningKeyPublic: b64(s.senderSigningKey?.public)
        }))
    }

    return Buffer.from(JSON.stringify(out), 'utf-8')
}

/** whatsmeow JSON bytes → IR sender-key proto bytes. */
export function whatsmeowSenderKeyJsonToProto(jsonBytes: Uint8Array): Uint8Array {
    const text = Buffer.from(jsonBytes).toString('utf-8')
    const obj = JSON.parse(text) as GoSenderKeyStructure

    const protoMsg = {
        senderKeyStates: (obj.SenderKeyStates ?? []).map((s) => ({
            senderKeyId: s.KeyID,
            senderChainKey: s.SenderChainKey
                ? {
                      iteration: s.SenderChainKey.Iteration,
                      seed: fromB64(s.SenderChainKey.ChainKey)
                  }
                : undefined,
            senderSigningKey: {
                public: fromB64(s.SigningKeyPublic),
                private: fromB64(s.SigningKeyPrivate)
            },
            senderMessageKeys: (s.Keys ?? []).map((k) => ({
                iteration: k.Iteration,
                seed: fromB64(k.Seed)
            }))
        }))
    }

    return SenderKeyRecordStructure.encode(protoMsg).finish() as Uint8Array
}
