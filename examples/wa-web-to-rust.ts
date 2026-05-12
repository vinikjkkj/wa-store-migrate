/* eslint-disable */
/**
 * Live test of the wa-web → whatsapp-rust migration.
 *
 *   node --import tsx examples/wa-web-to-rust.ts
 *
 * Pipeline:
 *   1. Read `.auth/wa-web-dump-from-web.json` (produced by wa-web-dump.js).
 *   2. Migrate via `migrate({from: waWebAdapter, to: whatsappRustAdapter})`.
 *   3. Build a fresh SQLite database under `.auth/wa-web-rust.db`,
 *      applying the rust schema by concatenating every `up.sql` from
 *      `whatsapp-rust/storages/sqlite-storage/migrations/` (sorted by
 *      directory name — diesel applies them in that order).
 *   4. INSERT the migrated rows.
 *   5. Print instructions to copy the DB into the rust workspace and
 *      `cargo run` against it.
 *
 * The rust client expects `whatsapp.db` next to its binary; copying is
 * the user's call (we don't touch the source tree from here).
 */

import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'

import Database from 'better-sqlite3'

import type { WaWebSnapshot } from '@adapters/wa-web'
import type { WhatsappRustSnapshot } from '@adapters/whatsapp-rust'
import { bufferJsonReviver } from '@codec/buffer-json'
import { migrate } from '@migrate'

const IN = process.env.WA_WEB_DUMP ?? '.auth/wa-web-dump-from-web.json'
const OUT_DB = process.env.OUT_DB ?? '.auth/wa-web-rust.db'
const RUST_MIGRATIONS_DIR = resolve('whatsapp-rust/storages/sqlite-storage/migrations')
// Multi-account schema uses a per-device id; we provision a single device
// with id=1 (matches diesel's default after the multi-account migration).
const DEVICE_ID = 1

function applyMigrations(db: Database.Database): void {
    const dirs = readdirSync(RUST_MIGRATIONS_DIR).filter((d) => !d.startsWith('.'))
    dirs.sort()
    db.exec('PRAGMA foreign_keys = OFF')

    // diesel-migrations checks `__diesel_schema_migrations` to decide which
    // migrations are pending. Create that tracker FIRST and register every
    // migration we apply so the rust client sees them as already-applied
    // when it opens the DB. The version is the directory-name prefix
    // before `_` (e.g. `2025-08-14-035031` for `2025-08-14-035031_initial`).
    db.exec(`CREATE TABLE IF NOT EXISTS __diesel_schema_migrations (
        version VARCHAR(50) PRIMARY KEY NOT NULL,
        run_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`)
    const recordVersion = db.prepare(
        'INSERT OR IGNORE INTO __diesel_schema_migrations (version) VALUES (?)'
    )

    for (const d of dirs) {
        const upPath = join(RUST_MIGRATIONS_DIR, d, 'up.sql')
        const sql = readFileSync(upPath, 'utf-8')
        try {
            db.exec(sql)
        } catch (e) {
            throw new Error(`migration ${d} failed: ${(e as Error).message}`)
        }
        const underscore = d.indexOf('_')
        // diesel strips dashes from the timestamp prefix when computing the
        // migration version (`2025-08-14-035031` → `20250814035031`).
        const rawPrefix = underscore >= 0 ? d.slice(0, underscore) : d
        const version = rawPrefix.replace(/-/g, '')
        recordVersion.run(version)
    }
    db.exec('PRAGMA foreign_keys = ON')
}

function concatKeyPair(kp: { pubKey: Uint8Array; privKey: Uint8Array }): Buffer {
    // rust's `key_pair_serde::serialize` writes `priv (32) || pub (32)`.
    return Buffer.concat([Buffer.from(kp.privKey), Buffer.from(kp.pubKey)])
}

function insertSnapshot(db: Database.Database, snap: WhatsappRustSnapshot): void {
    const d = snap.device
    db.prepare(
        `INSERT INTO device (
            id, lid, pn, registration_id,
            noise_key, identity_key, signed_pre_key, signed_pre_key_id, signed_pre_key_signature,
            adv_secret_key, account, push_name,
            app_version_primary, app_version_secondary, app_version_tertiary, app_version_last_fetched_ms,
            edge_routing_info, props_hash, next_pre_key_id, nct_salt, server_has_prekeys, server_cert_chain
        ) VALUES (?, ?, ?, ?,  ?, ?, ?, ?, ?,  ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?, ?, ?, ?)`
    ).run(
        DEVICE_ID,
        d.lid ?? '',
        d.pn ?? '',
        d.registrationId,
        concatKeyPair(d.noiseKey),
        concatKeyPair(d.identityKey),
        concatKeyPair(d.signedPreKey),
        d.signedPreKeyId,
        Buffer.from(d.signedPreKeySignature),
        Buffer.from(d.advSecretKey),
        d.account ? Buffer.from(d.account) : null,
        d.pushName ?? '',
        d.appVersionPrimary ?? 0,
        d.appVersionSecondary ?? 0,
        d.appVersionTertiary ?? 0,
        d.appVersionLastFetchedMs ?? 0,
        d.edgeRoutingInfo ? Buffer.from(d.edgeRoutingInfo) : null,
        d.propsHash ?? null,
        d.nextPreKeyId ?? 0,
        d.nctSalt ? Buffer.from(d.nctSalt) : null,
        d.serverHasPrekeys ? 1 : 0,
        d.serverCertChain ? Buffer.from(d.serverCertChain.bytes) : null
    )

    if (snap.preKeys?.length) {
        const stmt = db.prepare(
            'INSERT INTO prekeys (id, key, uploaded, device_id) VALUES (?, ?, ?, ?)'
        )
        for (const k of snap.preKeys) {
            stmt.run(k.keyId, concatKeyPair(k.keyPair), k.uploaded ? 1 : 0, DEVICE_ID)
        }
    }

    // signed_prekeys table is a separate index (record-style) — rust's
    // active SPK lives in `device.signed_pre_key*`, this table is for
    // history. We leave it empty.

    if (snap.identities?.length) {
        const stmt = db.prepare('INSERT INTO identities (address, key, device_id) VALUES (?, ?, ?)')
        for (const i of snap.identities) {
            stmt.run(i.address, Buffer.from(i.key), DEVICE_ID)
        }
    }

    if (snap.sessions?.length) {
        const stmt = db.prepare(
            'INSERT INTO sessions (address, record, device_id) VALUES (?, ?, ?)'
        )
        for (const s of snap.sessions) {
            stmt.run(s.address, Buffer.from(s.record), DEVICE_ID)
        }
    }

    if (snap.senderKeys?.length) {
        const stmt = db.prepare(
            'INSERT INTO sender_keys (address, record, device_id) VALUES (?, ?, ?)'
        )
        for (const sk of snap.senderKeys) {
            stmt.run(sk.address, Buffer.from(sk.record), DEVICE_ID)
        }
    }

    if (snap.appStateKeys?.length) {
        const stmt = db.prepare(
            'INSERT INTO app_state_keys (key_id, key_data, device_id) VALUES (?, ?, ?)'
        )
        for (const k of snap.appStateKeys) {
            stmt.run(Buffer.from(k.keyId), Buffer.from(k.keyData), DEVICE_ID)
        }
    }

    if (snap.appStateVersions?.length) {
        const stmt = db.prepare(
            'INSERT INTO app_state_versions (name, state_data, device_id) VALUES (?, ?, ?)'
        )
        for (const v of snap.appStateVersions) {
            stmt.run(v.name, Buffer.from(v.stateData), DEVICE_ID)
        }
    }

    if (snap.appStateMutationMacs?.length) {
        const stmt = db.prepare(
            `INSERT INTO app_state_mutation_macs
             (name, version, index_mac, value_mac, device_id)
             VALUES (?, ?, ?, ?, ?)`
        )
        for (const m of snap.appStateMutationMacs) {
            stmt.run(m.name, m.version, Buffer.from(m.indexMac), Buffer.from(m.valueMac), DEVICE_ID)
        }
    }

    if (snap.tcTokens?.length) {
        const stmt = db.prepare(
            `INSERT INTO tc_tokens
             (jid, token, token_timestamp, sender_timestamp, device_id, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`
        )
        const now = Date.now()
        for (const t of snap.tcTokens) {
            stmt.run(
                t.jid,
                Buffer.from(t.token),
                t.tokenTimestamp,
                t.senderTimestamp ?? null,
                DEVICE_ID,
                now
            )
        }
    }

    if (snap.deviceRegistry?.length) {
        const stmt = db.prepare(
            `INSERT INTO device_registry
             (user_id, devices_json, timestamp, phash, device_id, updated_at, raw_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        const now = Date.now()
        for (const dr of snap.deviceRegistry) {
            stmt.run(
                dr.userJid,
                dr.devicesJson,
                dr.timestamp,
                dr.phash ?? null,
                DEVICE_ID,
                now,
                dr.rawId ?? null
            )
        }
    }

    if (snap.lidPnMapping?.length) {
        const stmt = db.prepare(
            `INSERT INTO lid_pn_mapping
             (lid, phone_number, created_at, learning_source, updated_at, device_id)
             VALUES (?, ?, ?, ?, ?, ?)`
        )
        for (const m of snap.lidPnMapping) {
            stmt.run(m.lid, m.phoneNumber, m.createdAt, m.learningSource, m.updatedAt, DEVICE_ID)
        }
    }
}

async function main(): Promise<void> {
    const text = readFileSync(IN, 'utf-8')
    const dump = JSON.parse(text, bufferJsonReviver) as WaWebSnapshot

    if (!dump.device.noiseKey) {
        console.error('wa-web dump has no noiseKey — aborting (cannot Noise-handshake).')
        process.exit(1)
    }

    console.log('[1] migrating wa-web → whatsapp-rust …')
    const { data: rustSnap, losses } = migrate({
        from: 'wa-web',
        to: 'whatsapp-rust',
        data: dump,
        validate: false
    })
    console.log(`    pn:                  ${rustSnap.device.pn ?? '(none)'}`)
    console.log(`    lid:                 ${rustSnap.device.lid ?? '(none)'}`)
    console.log(`    registrationId:      ${rustSnap.device.registrationId}`)
    console.log(`    preKeys:             ${rustSnap.preKeys?.length ?? 0}`)
    console.log(`    identities:          ${rustSnap.identities?.length ?? 0}`)
    console.log(`    sessions:            ${rustSnap.sessions?.length ?? 0}`)
    console.log(`    senderKeys:          ${rustSnap.senderKeys?.length ?? 0}`)
    console.log(`    appStateKeys:        ${rustSnap.appStateKeys?.length ?? 0}`)
    console.log(`    appStateVersions:    ${rustSnap.appStateVersions?.length ?? 0}`)
    console.log(`    appStateMutationMacs:${rustSnap.appStateMutationMacs?.length ?? 0}`)
    console.log(`    tcTokens:            ${rustSnap.tcTokens?.length ?? 0}`)
    console.log(`    deviceRegistry:      ${rustSnap.deviceRegistry?.length ?? 0}`)
    if (losses.length > 0) {
        for (const l of losses) console.log(`    [loss] ${l.severity} ${l.domain}×${l.count}`)
    }

    const dbPath = resolve(OUT_DB)
    mkdirSync(dirname(dbPath), { recursive: true })
    if (process.env.RESET === '1') {
        try {
            await import('node:fs').then((fs) => fs.unlinkSync(dbPath))
            console.log('[reset] removed existing DB')
        } catch {
            /* not present */
        }
    }

    console.log(`\n[2] applying rust schema migrations to ${dbPath} …`)
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    applyMigrations(db)
    console.log('    schema applied')

    console.log('\n[3] inserting migrated rows …')
    const tx = db.transaction(() => insertSnapshot(db, rustSnap))
    tx()
    db.close()
    console.log('    done')

    console.log(`\n✓ wrote ${dbPath}`)
    console.log('\nNext step:')
    console.log(`  cd whatsapp-rust`)
    console.log(`  cp "${dbPath}" whatsapp.db`)
    console.log(`  cargo run`)
    console.log('\nNote: connecting will kick the live wa-web tab (one companion at a time).')
}

void main().catch((e) => {
    console.error(e)
    process.exit(1)
})
