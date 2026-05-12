# IR JSON Wire Format

The IR (Intermediate Representation) is `wa-store-migrate`'s lib-neutral shape
for a WhatsApp Multi-Device store. It carries everything Signal/WhatsApp needs
to keep a paired companion device functional after migration: identity, prekey
material, sessions, sender keys, app-state sync, contacts, etc.

This document specifies the **JSON wire format** of the IR — the portable form
produced by `snapshot.toJSON()` and consumed by `snapshot.fromJSON()`. It is
the contract for non-TypeScript consumers (Go/Rust services that read IR JSON
from disk / S3 / message queue and load it into their native store).

## Versioning

```json
{ "schemaVersion": 1, ... }
```

`schemaVersion` is an integer. Adding optional fields is non-breaking and does
not bump the version. Removing or changing the meaning of an existing field
bumps it. Consumers MUST refuse JSON whose `schemaVersion` they do not
recognize.

## Encoding rules

| TS shape             | JSON shape                       | Notes                                            |
| -------------------- | -------------------------------- | ------------------------------------------------ |
| `Uint8Array` / bytes | base64 string (RFC 4648, padded) | No `{type:'Buffer'}` wrapper. Just the string.   |
| `Map<K, V>`          | `Array<[K, V]>` (pair tuples)    | Preserves number keys. Order is insertion order. |
| Optional `T`         | field omitted when absent        | Never `null` and never explicit `undefined`.     |
| Number, string, bool | JSON native                      | —                                                |

## Top-level shape

```jsonc
{
  "schemaVersion": 1,
  "source": "baileys" | "zapo" | "wa-web" | "whatsmeow" | "whatsapp-rust",
  "identity":      <IrIdentity>,         // required (scalar)
  "signedPreKey":  <IrSignedPreKey>,     // required (scalar)
  "preKeys":                Array<[number, IrPreKey]>,
  "signalIdentities":       Array<[string, base64]>,
  "sessions":               Array<[string, { address: IrAddress, record: { proto: base64 } }]>,
  "senderKeys":             Array<[string, { groupSender: IrGroupSender, record: { proto: base64 } }]>,
  "senderKeyDistributions": Array<[string, IrSenderKeyDistribution]>,
  "appStateSyncKeys":       Array<[string, IrAppStateSyncKey]>,
  "appStateVersions":       Array<[string, IrLTHashState]>,
  "privacyTokens":          Array<[string, IrPrivacyToken]>,
  "deviceLists":            Array<[string, IrDeviceList]>,
  "contacts":               Array<[string, IrContact]>,
  "messageSecrets":         Array<[string, IrMessageSecret]>
}
```

All array fields are present and may be empty (`[]`). Identity and
signedPreKey are required scalars.

## Map keys

The IR uses string keys derived from the entry contents. Consumers do not need
to recompute them on read — the key is always present alongside the value. For
producers, the rules are:

| Domain                   | Key format                                                      |
| ------------------------ | --------------------------------------------------------------- |
| `preKeys`                | The `keyId` (number).                                           |
| `signalIdentities`       | `irAddressKey(address)` — see below.                            |
| `sessions`               | `irAddressKey(address)`                                         |
| `senderKeys`             | `irGroupSenderKey(groupSender)`                                 |
| `senderKeyDistributions` | `irGroupSenderKey(groupSender)`                                 |
| `appStateSyncKeys`       | `base64(keyId)` — the bytes of the key id.                      |
| `appStateVersions`       | `collection` name (e.g. `"regular"`, `"critical_unblock_low"`). |
| `privacyTokens`          | `jid` (the target user JID).                                    |
| `deviceLists`            | `userJid`                                                       |
| `contacts`               | `jid`                                                           |
| `messageSecrets`         | `messageId`                                                     |

### `irAddressKey`

```text
`${address.user}${address.server ? '@' + address.server : ''}:${address.device}${address.agent !== undefined ? '_' + address.agent : ''}`
```

Examples:

- `{ user: "5511999999999", device: 0 }` → `"5511999999999:0"`
- `{ user: "5511999999999", device: 1, server: "s.whatsapp.net" }` → `"5511999999999@s.whatsapp.net:1"`
- `{ user: "abc", device: 0, agent: 1 }` → `"abc:0_1"`

### `irGroupSenderKey`

```text
`${groupSender.groupId}//${irAddressKey(groupSender.sender)}`
```

Example: `"group@g.us//5511999999999:0"`

## Domain shapes

### `IrAddress`

```jsonc
{
  "user":   string,
  "device": number,         // 0 = primary device
  "agent"?:  number,
  "server"?: "lid" | "s.whatsapp.net"
}
```

### `IrGroupSender`

```jsonc
{ "groupId": string, "sender": IrAddress }
```

### `IrKeyPair`

```jsonc
{ "pubKey": base64, "privKey": base64 }
```

Curve25519 public keys are 33 bytes (the libsignal `0x05` type prefix is
included). Private keys are 32 bytes.

### `IrSignedPreKey`

```jsonc
{
  "keyId":     number,
  "keyPair":   IrKeyPair,
  "signature": base64,        // 64 bytes
  "timestampS"?: number,
  "uploaded"?:   boolean
}
```

### `IrPreKey`

```jsonc
{
  "keyId":     number,
  "keyPair":   IrKeyPair,
  "uploaded"?: boolean
}
```

### `IrSignedIdentity`

```jsonc
{
  "details"?:             base64,   // proto-encoded ADVSignedDeviceIdentity.details
  "accountSignatureKey"?: base64,   // 32 bytes
  "accountSignature"?:    base64,   // 64 bytes
  "deviceSignature"?:     base64    // 64 bytes
}
```

### `IrIdentity`

```jsonc
{
  "noiseKeyPair":          IrKeyPair,        // 32-byte keys (Noise XK)
  "signedIdentityKeyPair": IrKeyPair,        // pubKey is 33 bytes (0x05 prefixed)
  "registrationId":        number,           // 14-bit unsigned int (0..16383)
  "advSecretKey":          base64,           // 32 bytes
  "signedIdentity"?:       IrSignedIdentity,
  "meJid"?:                string,
  "meLid"?:                string,
  "meDisplayName"?:        string,
  "platform"?:             string,
  "routingInfo"?:          base64,
  "accountSyncCounter"?:   number,
  "accountCreationTs"?:    number
}
```

### Sessions / sender keys

Both are stored as raw libsignal proto bytes (`SessionStructure` /
`SenderKeyRecord`). The wrapper carries the address so consumers don't have
to re-parse the key string.

```jsonc
// sessions entry
[ "<irAddressKey>",
  { "address": IrAddress, "record": { "proto": base64 } }
]

// senderKeys entry
[ "<irGroupSenderKey>",
  { "groupSender": IrGroupSender, "record": { "proto": base64 } }
]
```

### `IrSenderKeyDistribution`

```jsonc
{
  "groupSender": IrGroupSender,
  "keyId":       number,
  "timestampMs": number
}
```

### `IrAppStateSyncKey`

```jsonc
{
  "keyId":     base64,
  "keyData":   base64,
  "timestamp"?: number,
  "fingerprint"?: {
    "rawId"?:         number,
    "currentIndex"?:  number,
    "deviceIndexes"?: number[]
  }
}
```

### `IrLTHashState`

```jsonc
{
  "collection":     string,        // e.g. "regular", "critical_unblock_low"
  "version":        number,
  "hash":           base64,        // 128 bytes
  "indexValueMap":  Array<[string, base64]>   // base64(indexMac) → valueMac bytes
}
```

### `IrPrivacyToken`

```jsonc
{
  "jid":                string,
  "token"?:             base64,
  "timestampMs"?:       number,
  "senderTimestampMs"?: number,
  "nctSalt"?:           base64
}
```

### `IrDeviceList`

```jsonc
{
  "userJid":     string,
  "deviceJids":  string[],
  "updatedAtMs": number
}
```

### `IrContact`

```jsonc
{
  "jid":              string,
  "displayName"?:     string,
  "pushName"?:        string,
  "verifiedName"?:    string,
  "lid"?:             string,
  "phoneNumber"?:     string,
  "lastUpdatedMs"?:   number
}
```

### `IrMessageSecret`

```jsonc
{
  "messageId":  string,
  "senderJid":  string,
  "chatJid"?:   string,           // defaults to senderJid for 1-on-1
  "secret":     base64
}
```

## Minimal example

```json
{
    "schemaVersion": 1,
    "source": "baileys",
    "identity": {
        "noiseKeyPair": { "pubKey": "ERER...", "privKey": "EhIS..." },
        "signedIdentityKeyPair": { "pubKey": "BQEC...", "privKey": "MjIy..." },
        "registrationId": 1111,
        "advSecretKey": "qwsr..."
    },
    "signedPreKey": {
        "keyId": 1,
        "keyPair": { "pubKey": "QUFB...", "privKey": "QkJC..." },
        "signature": "UVFR...",
        "uploaded": true
    },
    "preKeys": [],
    "signalIdentities": [],
    "sessions": [],
    "senderKeys": [],
    "senderKeyDistributions": [],
    "appStateSyncKeys": [],
    "appStateVersions": [],
    "privacyTokens": [],
    "deviceLists": [],
    "contacts": [],
    "messageSecrets": []
}
```

## Implementing a reader in Go / Rust

The shape maps cleanly onto idiomatic struct decoders:

**Go**: declare structs with `json` tags. Decode `base64` fields with
`base64.StdEncoding.DecodeString`. The pair-array maps decode into
`[][2]any` and you split them in code, or model each as a struct with two
positional fields via a custom `UnmarshalJSON`.

**Rust**: use `serde` with `#[derive(Deserialize)]`. Bytes can be
`#[serde(with = "serde_bytes")]` over a base64 string (or decode in a
custom function). The pair arrays decode into `Vec<(K, V)>`.

In both cases, treat the JSON as the **source of truth**. Do not attempt to
re-derive map keys — trust the keys present in the wire data.

## Versioning policy

`schemaVersion` is owned by this repo. Bumps will:

- Always be announced in `CHANGELOG.md`.
- Be accompanied by a migration note when a value's semantics changes.
- Never silently change the JSON shape of an existing field within a
  version.

Consumers should pin a `schemaVersion` and reject unknown values explicitly.
