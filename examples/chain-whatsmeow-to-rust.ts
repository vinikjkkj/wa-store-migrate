/* eslint-disable */
/**
 * Chain step: read whatsmeow's sqlite (populated by chain-zapo-to-whatsmeow.ts
 * after the Go runner connected and advanced state), convert through the IR,
 * emit a `whatsapp-rust` JSON dump in the same shape the rust runner consumes
 * (raw base64, matches `snapshot.toJSON('whatsapp-rust', ir)`), then spawn
 * the rust runner with `WA_IR_JSON` so it imports + connects.
 *
 *   node --import tsx examples/chain-whatsmeow-to-rust.ts
 *
 * Env:
 *   IN_DB     whatsmeow sqlite source (default .auth/whatsmeow.db)
 *   OUT_JSON  rust IR dump (default .auth/whatsmeow-to-rust.json)
 *   OUT_DB    rust SqliteStore output path passed to runner (default
 *             .auth/whatsapp_imported.db)
 *   ME_DEV    which device jid to read (default :49)
 *   EXIT_MS   rust runner stay-alive (default 90000)
 */

import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import Database from 'better-sqlite3'
import nacl from 'tweetnacl'

import type { WhatsmeowSnapshot } from '@adapters/whatsmeow'
import { snapshot } from '@api'

const IN_DB = process.env.IN_DB ?? '.auth/whatsmeow.db'
const OUT_JSON = process.env.OUT_JSON ?? '.auth/whatsmeow-to-rust.json'
const OUT_DB = process.env.OUT_DB ?? '.auth/whatsapp_imported.db'
const ME_DEV = Number(process.env.ME_DEV ?? '49')

function kpFromPriv(priv: Buffer): { pubKey: Uint8Array; privKey: Uint8Array } {
    // whatsmeow stores Curve25519 keys as the 32-byte private only; derive
    // the public via scalarMult.base.
    const p = new Uint8Array(priv)
    return { privKey: p, pubKey: nacl.scalarMult.base(p) }
}

function readWhatsmeowDb(dbPath: string, deviceIndex: number): WhatsmeowSnapshot {
    const db = new Database(dbPath, { readonly: true })
    const dev = db
        .prepare('SELECT * FROM whatsmeow_device WHERE jid LIKE ? ORDER BY rowid DESC LIMIT 1')
        .get(`%:${deviceIndex}@%`) as Record<string, unknown> | undefined
    if (!dev) throw new Error(`no whatsmeow_device row for device :${deviceIndex}`)
    const ourJid = dev.jid as string

    const preKeys = (
        db
            .prepare(
                'SELECT key_id, key, uploaded FROM whatsmeow_pre_keys WHERE jid = ? ORDER BY key_id'
            )
            .all(ourJid) as { key_id: number; key: Buffer; uploaded: number }[]
    ).map((r) => ({
        keyId: r.key_id,
        keyPair: kpFromPriv(r.key),
        uploaded: !!r.uploaded
    }))

    const identities = (
        db
            .prepare('SELECT their_id, identity FROM whatsmeow_identity_keys WHERE our_jid = ?')
            .all(ourJid) as { their_id: string; identity: Buffer }[]
    ).map((r) => ({
        addr: r.their_id,
        identityKey: new Uint8Array(r.identity)
    }))

    const sessions = (
        db
            .prepare('SELECT their_id, session FROM whatsmeow_sessions WHERE our_jid = ?')
            .all(ourJid) as { their_id: string; session: Buffer }[]
    ).map((r) => ({
        addr: r.their_id,
        session: new Uint8Array(r.session)
    }))

    const senderKeys = (
        db
            .prepare(
                'SELECT chat_id, sender_id, sender_key FROM whatsmeow_sender_keys WHERE our_jid = ?'
            )
            .all(ourJid) as {
            chat_id: string
            sender_id: string
            sender_key: Buffer
        }[]
    ).map((r) => ({
        groupId: r.chat_id,
        senderAddr: r.sender_id,
        record: new Uint8Array(r.sender_key)
    }))

    const appStateSyncKeys = (
        db
            .prepare(
                'SELECT key_id, key_data, timestamp, fingerprint FROM whatsmeow_app_state_sync_keys WHERE jid = ?'
            )
            .all(ourJid) as {
            key_id: Buffer
            key_data: Buffer
            timestamp: number
            fingerprint: Buffer
        }[]
    ).map((r) => ({
        keyId: new Uint8Array(r.key_id),
        keyData: new Uint8Array(r.key_data),
        timestamp: r.timestamp,
        fingerprint: new Uint8Array(r.fingerprint)
    }))

    const appStateVersions = (
        db
            .prepare('SELECT name, version, hash FROM whatsmeow_app_state_version WHERE jid = ?')
            .all(ourJid) as { name: string; version: number; hash: Buffer }[]
    ).map((r) => ({
        collection: r.name,
        version: r.version,
        hash: new Uint8Array(r.hash)
    }))

    const appStateMutationMacs = (
        db
            .prepare(
                'SELECT name, version, index_mac, value_mac FROM whatsmeow_app_state_mutation_macs WHERE jid = ? ORDER BY name, version'
            )
            .all(ourJid) as {
            name: string
            version: number
            index_mac: Buffer
            value_mac: Buffer
        }[]
    ).map((r) => ({
        collection: r.name,
        version: r.version,
        indexMac: new Uint8Array(r.index_mac),
        valueMac: new Uint8Array(r.value_mac)
    }))

    db.close()

    return {
        device: {
            noiseKey: kpFromPriv(dev.noise_key as Buffer),
            identityKey: kpFromPriv(dev.identity_key as Buffer),
            signedPreKey: {
                keyId: dev.signed_pre_key_id as number,
                keyPair: kpFromPriv(dev.signed_pre_key as Buffer),
                signature: new Uint8Array(dev.signed_pre_key_sig as Buffer)
            },
            registrationId: dev.registration_id as number,
            advSecretKey: new Uint8Array(dev.adv_key as Buffer),
            ...(dev.adv_details
                ? {
                      account: {
                          details: new Uint8Array(dev.adv_details as Buffer),
                          accountSignatureKey: new Uint8Array(dev.adv_account_sig_key as Buffer),
                          accountSignature: new Uint8Array(dev.adv_account_sig as Buffer),
                          deviceSignature: new Uint8Array(dev.adv_device_sig as Buffer)
                      }
                  }
                : {}),
            ...(dev.platform ? { platform: dev.platform as string } : {}),
            ...(dev.business_name ? { businessName: dev.business_name as string } : {}),
            ...(dev.push_name ? { pushName: dev.push_name as string } : {}),
            meJid: ourJid,
            ...(dev.lid ? { meLid: dev.lid as string } : {}),
            ...(dev.facebook_uuid ? { facebookUuid: dev.facebook_uuid as string } : {}),
            initialized: true
        },
        preKeys,
        identities,
        sessions,
        senderKeys,
        appStateSyncKeys,
        appStateVersions,
        appStateMutationMacs
    }
}

async function main(): Promise<void> {
    const inDb = resolve(IN_DB)
    const outJson = resolve(OUT_JSON)
    const outDb = resolve(OUT_DB)

    console.log(`[1] reading whatsmeow.db from ${inDb} (device :${ME_DEV})…`)
    const w = readWhatsmeowDb(inDb, ME_DEV)
    console.log(
        `    me=${w.device.meJid ?? '?'} regId=${w.device.registrationId} ` +
            `preKeys=${w.preKeys?.length ?? 0} sessions=${w.sessions?.length ?? 0} ` +
            `senderKeys=${w.senderKeys?.length ?? 0} identities=${w.identities?.length ?? 0} ` +
            `appStateKeys=${w.appStateSyncKeys?.length ?? 0} ` +
            `appStateVersions=${w.appStateVersions?.length ?? 0}`
    )

    console.log('[2] whatsmeow → IR → whatsapp-rust …')
    const ir = snapshot.from('whatsmeow', w)
    const libJson = snapshot.toJSON('whatsapp-rust', ir)

    mkdirSync(dirname(outJson), { recursive: true })
    rmSync(outDb, { force: true })
    rmSync(`${outDb}-shm`, { force: true })
    rmSync(`${outDb}-wal`, { force: true })
    writeFileSync(outJson, JSON.stringify(libJson, null, 2), 'utf-8')
    console.log(`[3] ✓ wrote ${outJson}`)

    console.log('[4] spawning rust runner …')
    const runnerDir = resolve('examples/whatsapp-rust-runner')
    const child = spawn('cargo', ['run', '--release', '--manifest-path', 'Cargo.toml'], {
        cwd: runnerDir,
        env: {
            ...process.env,
            WA_IR_JSON: outJson,
            WA_DB_PATH: outDb,
            EXIT_MS: process.env.EXIT_MS ?? '90000',
            RUST_LOG: process.env.RUST_LOG ?? 'info'
        },
        stdio: 'inherit'
    })
    child.on('exit', (code) => {
        console.log(`[runner] exited code=${code}`)
        process.exit(code ?? 0)
    })
}

void main().catch((e) => {
    console.error('[chain] error:', e)
    process.exit(1)
})
