# wa-store-migrate

Universal store migrator for WhatsApp libraries. Convert auth+session state
between **zapo**, **baileys**, **whatsmeow**, **wa-web**, and **whatsapp-rust**
without re-pairing — every direction, no I/O.

## Why

Switching WhatsApp libs (or shipping a tool that consumes them all) means
mapping between five incompatible serialization shapes — different field names,
different libsignal session formats, different on-disk layouts. This library
collapses that work into:

```
sourceLib → IR (canonical snapshot) → destinationLib
```

You read your auth state into the source adapter's shape, call `migrate()`, and
write the result wherever your destination lib expects. No filesystem access,
no encryption keys handled internally, no global side effects. Pure conversion.

## Install

```sh
npm i wa-store-migrate
```

## Quick start

```ts
import { baileysAdapter, zapoAdapter, migrate } from 'wa-store-migrate'

// 1. Build the source-shaped object (see Recipes below for per-lib readers)
const baileysAuth = await readBaileysAuthState('.auth/baileys')

// 2. Convert
const { data, losses } = migrate({
    from: baileysAdapter,
    to: zapoAdapter,
    data: baileysAuth
})

// 3. Persist to your destination store (see Recipes below for per-lib writers)
await writeZapoSnapshot('.auth/zapo.sqlite', data)
```

## Recipes

Each lib needs a **read** function (lib-specific store → adapter input shape)
and a **write** function (adapter output shape → lib-specific store). The
adapter itself is `migrate({ from, to, data })`. Below are minimal
implementations of both sides for every supported lib.

### baileys

**Read** — multi-file auth state (the format `useMultiFileAuthState` produces):

```ts
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { bufferJsonReviver, type BaileysAuthSnapshot } from 'wa-store-migrate'

function readBaileysMultiFile(dir: string): BaileysAuthSnapshot {
    const creds = JSON.parse(readFileSync(join(dir, 'creds.json'), 'utf-8'), bufferJsonReviver)
    const keys: Record<string, Record<string, unknown>> = {}
    for (const f of readdirSync(dir)) {
        if (f === 'creds.json') continue
        const m = /^([a-z-]+)-(.+)\.json$/i.exec(f)
        if (!m) continue
        // baileys' fixFileName: `:` → `-`, `/` → `__`. Reverse it.
        const id = m[2]!.replace(/__/g, '/').replace(/-/g, ':')
        const value = JSON.parse(readFileSync(join(dir, f), 'utf-8'), bufferJsonReviver)
        ;(keys[m[1]!] ??= {})[id] = value
    }
    return { creds, keys: keys as never }
}
```

**Write** — back to a multi-file dir consumable by `useMultiFileAuthState`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { bufferJsonReplacer, type BaileysAuthSnapshot } from 'wa-store-migrate'

function writeBaileysMultiFile(dir: string, out: BaileysAuthSnapshot): void {
    mkdirSync(dir, { recursive: true })
    writeFileSync(
        resolve(dir, 'creds.json'),
        JSON.stringify(out.creds, bufferJsonReplacer, 2),
        'utf-8'
    )
    for (const [type, dict] of Object.entries(out.keys)) {
        for (const [id, value] of Object.entries(dict ?? {})) {
            if (!value) continue
            const safe = id.replace(/\//g, '__').replace(/:/g, '-')
            writeFileSync(
                resolve(dir, `${type}-${safe}.json`),
                JSON.stringify(value, bufferJsonReplacer, 2),
                'utf-8'
            )
        }
    }
}
```

Full example: [`examples/wa-web-to-baileys.ts`](examples/wa-web-to-baileys.ts)

### zapo

**Read** — pull from a `WaStore` (zapo-js's session store):

```ts
import type { WaStore } from 'zapo-js'
import type { ZapoStoreSnapshot } from 'wa-store-migrate'

async function readZapoStore(store: WaStore, sessionId: string): Promise<ZapoStoreSnapshot> {
    const s = store.session(sessionId)
    return {
        credentials: (await s.auth.snapshot())!,
        preKeys: await s.preKey.allPreKeys(),
        identities: await s.identity.allRemoteIdentities(),
        sessions: await s.session.allSessions(),
        senderKeys: await s.senderKey.allSenderKeys(),
        // optional domains — pull whichever your destination uses
        privacyTokens: await s.privacyToken.allTokens(),
        deviceLists: await s.deviceList.allUserDevices(),
        contacts: await s.contacts.all()
    }
}
```

**Write** — push into a fresh sqlite-backed `WaStore`:

```ts
import { createSqliteStore } from '@zapo-js/store-sqlite'
import { createStore } from 'zapo-js'
import type { ZapoStoreSnapshot } from 'wa-store-migrate'

async function writeZapoStore(
    sqlitePath: string,
    sessionId: string,
    data: ZapoStoreSnapshot
): Promise<void> {
    const store = createStore({
        backends: { sqlite: createSqliteStore({ path: sqlitePath, driver: 'auto' }) },
        providers: {
            auth: 'sqlite',
            signal: 'sqlite',
            preKey: 'sqlite',
            session: 'sqlite',
            identity: 'sqlite',
            senderKey: 'sqlite',
            appState: 'sqlite',
            messages: 'sqlite',
            threads: 'sqlite',
            contacts: 'sqlite',
            privacyToken: 'sqlite'
        }
    })
    const s = store.session(sessionId)
    await s.auth.save(data.credentials)
    for (const k of data.preKeys ?? []) await s.preKey.putPreKey(k)
    if (data.identities?.length) {
        await s.identity.setRemoteIdentities(
            data.identities.map((i) => ({ address: i.address, identityKey: i.identityKey }))
        )
    }
    if (data.sessions) {
        await s.session.setSessionsBatch(
            data.sessions.map((x) => ({ address: x.address, session: x.record as never }))
        )
    }
    for (const sk of data.senderKeys ?? []) {
        await s.senderKey.upsertSenderKey(sk.record as never)
    }
}
```

Full example: [`examples/wa-web-to-zapo.ts`](examples/wa-web-to-zapo.ts)

### whatsmeow

The Go side dumps to JSON; the JS side just reads/writes the JSON file. Use
this Go helper next to your bot:

```go
// In your whatsmeow project
import "encoding/base64"
import "encoding/json"

func DumpDevice(client *whatsmeow.Client) ([]byte, error) {
    d := client.Store
    return json.Marshal(map[string]any{
        "device": map[string]any{
            "noiseKey":     keyPair(d.NoiseKey),
            "identityKey":  keyPair(d.IdentityKey),
            "signedPreKey": signedPreKey(d.SignedPreKey),
            "registrationId": d.RegistrationID,
            "advSecretKey": base64.StdEncoding.EncodeToString(d.AdvSecretKey),
            "account":      account(d.Account),
            "meJid":        d.ID.String(),
            // …pull every Device field you need into the WhatsmeowDeviceRow shape
        },
        // sessions/sender-keys: read from your sqlstore — they're JSON
        // serializations of go.mau.fi/libsignal structs. Pass them through
        // as base64-encoded UTF-8 bytes.
    })
}
```

On the Node side:

```ts
import { readFileSync } from 'node:fs'
import { bufferJsonReviver, type WhatsmeowSnapshot } from 'wa-store-migrate'

function readWhatsmeowDump(jsonPath: string): WhatsmeowSnapshot {
    return JSON.parse(readFileSync(jsonPath, 'utf-8'), bufferJsonReviver)
}
```

Writing back: invert the Go helper — INSERT each row into the corresponding
sqlstore table. See `examples/baileys-to-whatsmeow.ts` for the field mapping.

### wa-web

**Read** — paste [`examples/wa-web-dump.js`](examples/wa-web-dump.js) into the
DevTools console of a logged-in `web.whatsapp.com` tab. It downloads
`wa-web-dump.json` directly from the browser. Then on the Node side:

```ts
import { readFileSync } from 'node:fs'
import { bufferJsonReviver, type WaWebSnapshot } from 'wa-store-migrate'

const dump = JSON.parse(
    readFileSync('.auth/wa-web-dump.json', 'utf-8'),
    bufferJsonReviver
) as WaWebSnapshot
```

**Write** — experimental and not shipped. Injecting a `WaWebSnapshot` back
into a fresh logged-in tab requires writing the corresponding IDB rows
from an in-page script that mirrors the dumper — none of the live-pair
flows have been validated end-to-end on the write side yet.

### whatsapp-rust

**Read** — `whatsapp-rust` uses a SQLite database (via `diesel`). Use
`better-sqlite3` to pull the rows:

```ts
import Database from 'better-sqlite3'
import type { WhatsappRustSnapshot } from 'wa-store-migrate'

function readRustDb(dbPath: string, deviceId = 1): WhatsappRustSnapshot {
    const db = new Database(dbPath, { readonly: true })
    const dev = db.prepare('SELECT * FROM device WHERE id = ?').get(deviceId) as any
    const splitKp = (b: Buffer) => ({
        privKey: new Uint8Array(b.subarray(0, 32)),
        pubKey: new Uint8Array(b.subarray(32, 64))
    })
    return {
        device: {
            registrationId: dev.registration_id,
            noiseKey: splitKp(dev.noise_key),
            identityKey: splitKp(dev.identity_key),
            signedPreKey: splitKp(dev.signed_pre_key),
            signedPreKeyId: dev.signed_pre_key_id,
            signedPreKeySignature: new Uint8Array(dev.signed_pre_key_signature),
            advSecretKey: new Uint8Array(dev.adv_secret_key),
            account: dev.account ? new Uint8Array(dev.account) : undefined,
            pn: dev.pn || undefined,
            lid: dev.lid || undefined,
            pushName: dev.push_name
        },
        preKeys: db
            .prepare('SELECT id, key, uploaded FROM prekeys WHERE device_id = ?')
            .all(deviceId)
            .map((r: any) => ({
                keyId: r.id,
                keyPair: splitKp(r.key),
                uploaded: !!r.uploaded
            })),
        sessions: db
            .prepare('SELECT address, record FROM sessions WHERE device_id = ?')
            .all(deviceId)
            .map((r: any) => ({ address: r.address, record: new Uint8Array(r.record) }))
        // …repeat for senderKeys, identities, app_state_*, tc_tokens, device_registry
    }
}
```

**Write** — apply the rust SQLite migrations + populate diesel's tracker so
the rust client treats the schema as already-applied:

```ts
import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { WhatsappRustSnapshot } from 'wa-store-migrate'

function writeRustDb(
    dbPath: string,
    migrationsDir: string, // path to whatsapp-rust/storages/sqlite-storage/migrations
    snap: WhatsappRustSnapshot,
    deviceId = 1
): void {
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec(`CREATE TABLE IF NOT EXISTS __diesel_schema_migrations (
        version VARCHAR(50) PRIMARY KEY NOT NULL,
        run_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`)
    const recordVersion = db.prepare(
        'INSERT OR IGNORE INTO __diesel_schema_migrations (version) VALUES (?)'
    )
    for (const d of readdirSync(migrationsDir).sort()) {
        db.exec(readFileSync(join(migrationsDir, d, 'up.sql'), 'utf-8'))
        // diesel strips dashes from the timestamp prefix
        const version = d.split('_')[0]!.replace(/-/g, '')
        recordVersion.run(version)
    }
    db.exec('PRAGMA foreign_keys = ON')

    // INSERT rows from `snap.device`, `snap.preKeys`, `snap.sessions`,
    // `snap.senderKeys`, `snap.identities`, `snap.appStateKeys`,
    // `snap.appStateVersions`, `snap.appStateMutationMacs`, `snap.tcTokens`,
    // `snap.deviceRegistry` — all FK'd to `device_id`.
    db.close()
}
```

Full example: [`examples/wa-web-to-rust.ts`](examples/wa-web-to-rust.ts)
shows the complete pipeline (every table populated end-to-end, including
the `bincode::HashState` encoding for `app_state_versions.state_data`).

## Direction matrix (20 routes)

|                     | → zapo | → baileys | → whatsmeow | → wa-web | → whatsapp-rust |
| ------------------- | :----: | :-------: | :---------: | :------: | :-------------: |
| **zapo →**          |   —    |     ✓     |      ✓      |    ✓     |        ✓        |
| **baileys →**       |   ✓    |     —     |      ✓      |    ✓     |        ✓        |
| **whatsmeow →**     |   ✓    |     ✓     |      —      |    ✓     |        ✓        |
| **wa-web →**        |   ✓    |     ✓     |      ✓      |    —     |        ✓        |
| **whatsapp-rust →** |   ✓    |     ✓     |      ✓      |    ✓     |        —        |

All 20 cross-direction routes are covered by the matrix test suite.

## Loss matrix

`migrate()` returns a `losses[]` array describing what didn't survive. There
are two severities:

- **`drop`** — destination cannot persist this domain at all
- **`warn`** — round-trip is structurally lossy (still works, fidelity reduced)

Drops per destination (when the source carries data in that domain):

| Destination     | Drops                            |
| --------------- | -------------------------------- |
| `zapo`          | none                             |
| `baileys`       | `contacts`, `messageSecrets`     |
| `whatsmeow`     | `deviceLists`                    |
| `wa-web`        | none (post-`c.us` normalization) |
| `whatsapp-rust` | `contacts`, `messageSecrets`     |

Warns (declared via `capabilities.lossy`):

| Adapter         | Domains                                   | Why                                                                                                                                                             |
| --------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baileys`       | `sessions`, `senderKeys`, `privacyTokens` | Skipped HKDF message keys dropped; only the latest sender-key state is kept (libsignal stores up to 5); privacyToken timestamp loses sub-second precision       |
| `whatsapp-rust` | `appStateVersions`                        | `state_data` is bincode `HashState`; the `index_value_map` field rides in `app_state_mutation_macs` — round-trip preserves `(version, hash, mutationMacs)` only |

## Filtering domains

Migrate only a subset:

```ts
migrate({
    from: waWebAdapter,
    to: baileysAdapter,
    data: dump,
    domains: ['preKeys', 'sessions', 'senderKeys'] // identity + signedPreKey always included
})
```

Excluded domains are cleared from the IR before the destination receives it,
and are not reported in `losses`.

## Validation

Catch shape/size bugs before they hit your store:

```ts
import { migrate } from 'wa-store-migrate'

const result = migrate({
    from: zapoAdapter,
    to: baileysAdapter,
    data,
    validate: true // throws SnapshotValidationError if structurally invalid
})
```

The validator is structural (key sizes, signature length, `registrationId`
range, empty proto bytes) — not cryptographic.

## Per-adapter notes

### `baileys`

Snapshot shape mirrors `AuthenticationState` from `baileys/src/Types/Auth.ts`:

```ts
{
    creds: BaileysAuthenticationCreds,
    keys: BaileysSignalDataSet
}
```

Both forms accepted on input: libsignal-node's JS object form (what
`SignalKeyStore` returns) or raw `Uint8Array`.

### `zapo`

Mirrors `zapo-js`'s store contracts. Sessions/sender-keys carry zapo's
`SignalSessionRecord` / `SenderKeyRecord` directly — no conversion needed
on adapter boundary, the IR stores them as proto bytes via zapo-js's encoder.

### `whatsmeow`

Sessions and sender-keys are persisted as the UTF-8 bytes of
`go.mau.fi/libsignal`'s JSON struct serialization (NOT proto wire format).
The adapter contains a hand-written codec for that mapping
([`go-libsignal-codec.ts`](src/adapters/whatsmeow/go-libsignal-codec.ts)).

### `wa-web`

Reading from a logged-in `web.whatsapp.com` browser tab. Use the dumper at
[`examples/wa-web-dump.js`](examples/wa-web-dump.js) — it walks the
`signal-storage` and `model-storage` IndexedDB databases via wa-web's own
internal modules (so encrypted columns like `WANoiseInfo` and
`orphan-tc-token.tcToken` decrypt transparently).

Notes:

- wa-web emits `c.us` for legacy PN JIDs; the IR normalizes to
  `s.whatsapp.net` so other libs accept the migrated session.
- wa-web wipes `advSecretKey` after pair-success (see
  `WAWebCompanionRegUtils.clearADVSecretKey`). Empty `advSecretKey` is a
  legitimate state — the validator accepts length 0.

### `whatsapp-rust`

Sessions/sender-keys are raw libsignal `RecordStructure` proto bytes (same
wire format as zapo — no codec layer). Address strings carry rust's
`<user>[:device]@<server>.0` form; `c.us` is normalized.

The `whatsapp-rust/whatsapp.db` SQLite schema is documented in
[`storages/sqlite-storage/migrations/`](https://github.com/jlucaso1/whatsapp-rust).
The example at [`examples/wa-web-to-rust.ts`](examples/wa-web-to-rust.ts)
shows a full wa-web → rust pipeline including diesel migration tracker
population and `bincode::HashState` encoding.

## API

```ts
import {
    // Adapters
    baileysAdapter,
    zapoAdapter,
    whatsmeowAdapter,
    waWebAdapter,
    whatsappRustAdapter,

    // Migration
    migrate,
    planLosses,

    // Validation
    validateSnapshot,
    assertValidSnapshot,
    SnapshotValidationError,

    // Codecs
    bufferJsonReviver,
    bufferJsonReplacer,
    parseLibsignalAddress,
    toLibsignalAddress,
    asBytes,
    ensurePrefixed33,
    stripPrefix33,

    // IR types
    type WaSnapshot,
    type IrAddress,
    type IrIdentity,
    type StoreAdapter,
    type AdapterCapabilities,
    type IrDomain
} from 'wa-store-migrate'
```

The library is a **pure conversion lib**. It never reads files, opens
sockets, or holds global state. The user owns I/O — both reading the source
state into the adapter shape and persisting the result on the destination
side.

## Custom stores

Each lib can have user-provided custom stores. Since adapters operate on
plain data shapes (not store interfaces), a custom store works as long as
the user can dump it to / load it from the documented snapshot shape. The
adapter contract is:

```ts
interface StoreAdapter<TIn, TOut = TIn> {
    readonly id: LibId
    readonly capabilities: AdapterCapabilities
    toCanonical(input: TIn): WaSnapshot
    fromCanonical(snapshot: WaSnapshot): TOut
}
```

Three guarantees:

- No I/O, no async, no global state.
- Bytes are always `Uint8Array` in the snapshot shape.
- Identity, signedPreKey, and the per-domain Maps are required by the
  snapshot type — adapters never produce a partial snapshot.

## Caveats

- **wa-web → \***: requires a logged-in browser tab. The dumper script must
  run inside that tab (DevTools console). Migrating off wa-web kicks the
  live tab out (WhatsApp permits one companion device at a time).
- **\* → wa-web**: experimental. The reverse-direction adapter is wired but
  the live injection path (browser-side load script) hasn't been validated
  end-to-end.
- **`advSecretKey` empty**: only matters for re-pair operations
  (companion-add). wa-web sources never carry it; sessions still work for
  every other operation (sending/receiving messages, app-state sync, etc).

## License

MIT
