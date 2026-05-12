/* eslint-disable */
/**
 * Chain step: read the live whatsapp-rust SqliteStore (populated and
 * advanced by the rust runner connecting to WA), convert through the
 * IR, write a baileys multi-file dir, then spawn baileys with that auth
 * and verify it connects + decrypts an incoming message.
 *
 *   node --import tsx examples/chain-rust-to-baileys.ts
 *
 * Env:
 *   RUST_DB     path to the rust SqliteStore (default .auth/whatsapp_imported.db)
 *   OUT_DIR     baileys multi-file output (default .auth/baileys_from_rust)
 *   EXIT_MS     stay-alive timeout (default 60000)
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import Database from 'better-sqlite3'

import type { BaileysAuthSnapshot } from '@adapters/baileys'
import type { WhatsappRustSnapshot } from '@adapters/whatsapp-rust'
import { snapshot } from '@api'
import { bufferJsonReplacer } from '@codec/buffer-json'

const RUST_DB = process.env.RUST_DB ?? '.auth/whatsapp_imported.db'
const OUT_DIR = process.env.OUT_DIR ?? '.auth/baileys_from_rust'
const EXIT_MS = Number(process.env.EXIT_MS ?? '60000')
const DEVICE_ID = 1

function splitKp(b: Buffer): { pubKey: Uint8Array; privKey: Uint8Array } {
    // rust's key_pair_serde: priv (32) || pub (32)
    return {
        privKey: new Uint8Array(b.subarray(0, 32)),
        pubKey: new Uint8Array(b.subarray(32, 64))
    }
}

function readRustDb(dbPath: string): WhatsappRustSnapshot {
    const db = new Database(dbPath, { readonly: true })
    const dev = db.prepare('SELECT * FROM device WHERE id = ?').get(DEVICE_ID) as any
    if (!dev) throw new Error(`no device row for id=${DEVICE_ID} in ${dbPath}`)

    const snap: WhatsappRustSnapshot = {
        device: {
            registrationId: dev.registration_id,
            noiseKey: splitKp(dev.noise_key),
            identityKey: splitKp(dev.identity_key),
            signedPreKey: splitKp(dev.signed_pre_key),
            signedPreKeyId: dev.signed_pre_key_id,
            signedPreKeySignature: new Uint8Array(dev.signed_pre_key_signature),
            advSecretKey: new Uint8Array(dev.adv_secret_key),
            ...(dev.account ? { account: new Uint8Array(dev.account) } : {}),
            ...(dev.pn ? { pn: dev.pn } : {}),
            ...(dev.lid ? { lid: dev.lid } : {}),
            ...(dev.push_name ? { pushName: dev.push_name } : {}),
            ...(dev.app_version_primary ? { appVersionPrimary: dev.app_version_primary } : {}),
            ...(dev.app_version_secondary
                ? { appVersionSecondary: dev.app_version_secondary }
                : {}),
            ...(dev.app_version_tertiary ? { appVersionTertiary: dev.app_version_tertiary } : {}),
            ...(dev.edge_routing_info
                ? { edgeRoutingInfo: new Uint8Array(dev.edge_routing_info) }
                : {}),
            ...(dev.next_pre_key_id ? { nextPreKeyId: dev.next_pre_key_id } : {}),
            ...(dev.server_has_prekeys !== null
                ? { serverHasPrekeys: !!dev.server_has_prekeys }
                : {})
        },
        preKeys: (
            db
                .prepare('SELECT id, key, uploaded FROM prekeys WHERE device_id = ? ORDER BY id')
                .all(DEVICE_ID) as any[]
        ).map((r) => ({
            keyId: r.id,
            keyPair: splitKp(r.key),
            uploaded: !!r.uploaded
        })),
        identities: (
            db
                .prepare('SELECT address, key FROM identities WHERE device_id = ?')
                .all(DEVICE_ID) as any[]
        ).map((r) => ({
            address: r.address,
            key: new Uint8Array(r.key)
        })),
        sessions: (
            db
                .prepare('SELECT address, record FROM sessions WHERE device_id = ?')
                .all(DEVICE_ID) as any[]
        ).map((r) => ({
            address: r.address,
            record: new Uint8Array(r.record)
        })),
        senderKeys: (
            db
                .prepare('SELECT address, record FROM sender_keys WHERE device_id = ?')
                .all(DEVICE_ID) as any[]
        ).map((r) => ({
            address: r.address,
            record: new Uint8Array(r.record)
        })),
        senderKeyDevices: (
            db
                .prepare(
                    'SELECT group_jid, device_jid, has_key FROM sender_key_devices WHERE device_id = ?'
                )
                .all(DEVICE_ID) as any[]
        ).map((r) => ({
            groupJid: r.group_jid,
            deviceJid: r.device_jid,
            hasKey: !!r.has_key
        })),
        appStateKeys: (
            db
                .prepare('SELECT key_id, key_data FROM app_state_keys WHERE device_id = ?')
                .all(DEVICE_ID) as any[]
        ).map((r) => ({
            keyId: new Uint8Array(r.key_id),
            keyData: new Uint8Array(r.key_data)
        })),
        appStateVersions: (
            db
                .prepare('SELECT name, state_data FROM app_state_versions WHERE device_id = ?')
                .all(DEVICE_ID) as any[]
        ).map((r) => ({
            name: r.name,
            stateData: new Uint8Array(r.state_data)
        })),
        appStateMutationMacs: (
            db
                .prepare(
                    `SELECT name, version, index_mac, value_mac
                     FROM app_state_mutation_macs
                     WHERE device_id = ? ORDER BY name, version`
                )
                .all(DEVICE_ID) as any[]
        ).map((r) => ({
            name: r.name,
            version: r.version,
            indexMac: new Uint8Array(r.index_mac),
            valueMac: new Uint8Array(r.value_mac)
        }))
    }
    db.close()
    return snap
}

function writeBaileysMultiFile(dir: string, out: BaileysAuthSnapshot): void {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    writeFileSync(
        join(dir, 'creds.json'),
        JSON.stringify(out.creds, bufferJsonReplacer, 2),
        'utf-8'
    )
    for (const [type, dict] of Object.entries(out.keys ?? {})) {
        for (const [id, value] of Object.entries(dict ?? {})) {
            if (!value) continue
            const safe = id.replace(/\//g, '__').replace(/:/g, '-')
            writeFileSync(
                join(dir, `${type}-${safe}.json`),
                JSON.stringify(value, bufferJsonReplacer, 2),
                'utf-8'
            )
        }
    }
}

async function main() {
    console.log(`[1] reading rust SqliteStore from ${RUST_DB} …`)
    const rust = readRustDb(resolve(RUST_DB))
    console.log(
        `    pn=${rust.device.pn ?? '?'} regId=${rust.device.registrationId} ` +
            `preKeys=${rust.preKeys?.length} sessions=${rust.sessions?.length} ` +
            `senderKeys=${rust.senderKeys?.length} appStateKeys=${rust.appStateKeys?.length} ` +
            `appStateVersions=${rust.appStateVersions?.length} mutMacs=${rust.appStateMutationMacs?.length}`
    )

    console.log('[2] converting rust → IR → baileys …')
    const ir = snapshot.from('whatsapp-rust', rust)
    const baileys = snapshot.to('baileys', ir)
    console.log(
        `    me=${baileys.creds.me?.id ?? '?'} regId=${baileys.creds.registrationId} ` +
            `preKeys=${Object.keys(baileys.keys['pre-key'] ?? {}).length} ` +
            `sessions=${Object.keys(baileys.keys.session ?? {}).length} ` +
            `senderKeys=${Object.keys(baileys.keys['sender-key'] ?? {}).length}`
    )

    const outDir = resolve(OUT_DIR)
    writeBaileysMultiFile(outDir, baileys)
    console.log(`[3] wrote multi-file to ${outDir} (${readdirSync(outDir).length} files)`)

    console.log('[4] spawning baileys + connecting …')
    const baileysPath = resolve(__dirname, '..', 'baileys', 'lib', 'index.js')
    // tsx supports ESM `import()` from a CommonJS-built TS file via the
    // node-style file path/URL; force-encode as file:// to avoid Windows
    // backslash issues.
    const baileysUrl = 'file:///' + baileysPath.replace(/\\/g, '/')
    const baileysMod: any = await import(baileysUrl)
    const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = baileysMod

    const { state, saveCreds } = await useMultiFileAuthState(outDir)
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false
    })

    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('connection.update', (u: any) => {
        if (u.connection) console.log(`[connection] ${u.connection}`)
        if (u.qr) console.log('[qr] ! requesting pair — migration credentials may be stale')
        if (u.lastDisconnect) {
            const err = u.lastDisconnect.error
            console.log(
                `[disconnect] reason=${err?.output?.statusCode ?? '?'} msg=${err?.message ?? err}`
            )
        }
    })
    sock.ev.on('messages.upsert', (ev: any) => {
        for (const m of ev.messages ?? []) {
            const text =
                m.message?.conversation ??
                m.message?.extendedTextMessage?.text ??
                m.message?.imageMessage?.caption ??
                '(non-text)'
            console.log(
                `[message] from=${m.key?.remoteJid ?? '?'} participant=${m.key?.participant ?? '?'} text=${JSON.stringify(text)}`
            )
        }
    })

    setTimeout(() => {
        console.log(`[exit] ${EXIT_MS}ms elapsed — closing`)
        try {
            sock.end(undefined as any)
        } catch {}
        process.exit(0)
    }, EXIT_MS)
}

void main().catch((e) => {
    console.error('[chain] error:', e)
    process.exit(1)
})
