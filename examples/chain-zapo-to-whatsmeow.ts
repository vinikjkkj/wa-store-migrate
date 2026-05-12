/* eslint-disable */
/**
 * Chain step: read the zapo `WaStore` (sqlite) populated by
 * `chain-baileys-to-zapo.ts`, convert through the IR via the high-level
 * `snapshot` API, write a whatsmeow JSON dump for the Go runner to consume,
 * then spawn the Go runner.
 *
 *   node --import tsx examples/chain-zapo-to-whatsmeow.ts
 *
 * Env:
 *   IN_DB        zapo sqlite source (default .auth/zapo_from_baileys.sqlite)
 *   OUT_JSON     whatsmeow dump output (default .auth/whatsmeow-dump.json)
 *   EXIT_MS      Go runner stay-alive (default 90000, set via WHATSMEOW_EXIT_MS)
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import Database from 'better-sqlite3'
import { proto } from 'zapo-js/proto'
import { decodeSenderKeyRecord, decodeSignalSessionRecord } from 'zapo-js/signal'

import type { ZapoStoreSnapshot } from '@adapters/zapo'
import { snapshot } from '@api'

const IN_DB = process.env.IN_DB ?? '.auth/zapo_from_baileys.sqlite'
const OUT_JSON = process.env.OUT_JSON ?? '.auth/whatsmeow-dump.json'
const SESSION_ID = 'chain-baileys-to-zapo'

function bytesAsBase64(_key: string, value: unknown): unknown {
    if (value instanceof Uint8Array) return Buffer.from(value).toString('base64')
    // Node `Buffer` has its own toJSON() that fires BEFORE this replacer,
    // turning byte fields into `{type:'Buffer', data: number[]}`. Catch
    // that shape here too — Array.isArray(data) means it's already that
    // intercepted form.
    if (
        value !== null &&
        typeof value === 'object' &&
        (value as { type?: unknown }).type === 'Buffer' &&
        Array.isArray((value as { data?: unknown }).data)
    ) {
        return Buffer.from((value as { data: number[] }).data).toString('base64')
    }
    return value
}

function readZapoStore(dbPath: string): ZapoStoreSnapshot {
    const db = new Database(dbPath, { readonly: true })
    const sid = SESSION_ID

    const cred = db.prepare('SELECT * FROM auth_credentials WHERE session_id = ?').get(sid) as
        | Record<string, unknown>
        | undefined
    if (!cred) throw new Error(`no auth_credentials row for session_id="${sid}"`)

    const credentials: ZapoStoreSnapshot['credentials'] = {
        noiseKeyPair: {
            pubKey: new Uint8Array(cred.noise_pub_key as Buffer),
            privKey: new Uint8Array(cred.noise_priv_key as Buffer)
        },
        registrationInfo: {
            registrationId: cred.registration_id as number,
            identityKeyPair: {
                pubKey: new Uint8Array(cred.identity_pub_key as Buffer),
                privKey: new Uint8Array(cred.identity_priv_key as Buffer)
            }
        },
        signedPreKey: {
            keyId: cred.signed_prekey_id as number,
            keyPair: {
                pubKey: new Uint8Array(cred.signed_prekey_pub_key as Buffer),
                privKey: new Uint8Array(cred.signed_prekey_priv_key as Buffer)
            },
            signature: new Uint8Array(cred.signed_prekey_signature as Buffer),
            uploaded: true
        },
        advSecretKey: new Uint8Array(cred.adv_secret_key as Buffer),
        ...(cred.signed_identity
            ? {
                  // zapo persists signedIdentity as proto-encoded
                  // ADVSignedDeviceIdentity. Decode here so the adapter sees
                  // the structured `{details, accountSignatureKey, ...}` shape
                  // it expects (whatsmeow's sqlstore enforces NOT NULL on the
                  // signature columns).
                  signedIdentity: proto.ADVSignedDeviceIdentity.decode(
                      new Uint8Array(cred.signed_identity as Buffer)
                  ) as never
              }
            : {}),
        ...(cred.me_jid ? { meJid: cred.me_jid as string } : {}),
        ...(cred.me_lid ? { meLid: cred.me_lid as string } : {}),
        ...(cred.me_display_name ? { meDisplayName: cred.me_display_name as string } : {}),
        ...(cred.platform ? { platform: cred.platform as string } : {}),
        ...(cred.routing_info ? { routingInfo: new Uint8Array(cred.routing_info as Buffer) } : {})
    } as never

    const preKeys = (
        db
            .prepare(
                'SELECT key_id, pub_key, priv_key, uploaded FROM signal_prekey WHERE session_id = ? ORDER BY key_id'
            )
            .all(sid) as { key_id: number; pub_key: Buffer; priv_key: Buffer; uploaded: number }[]
    ).map((r) => ({
        keyId: r.key_id,
        keyPair: { pubKey: new Uint8Array(r.pub_key), privKey: new Uint8Array(r.priv_key) },
        uploaded: !!r.uploaded
    }))

    const identities = (
        db
            .prepare(
                'SELECT user, server, device, identity_key FROM signal_identity WHERE session_id = ?'
            )
            .all(sid) as { user: string; server: string; device: number; identity_key: Buffer }[]
    ).map((r) => ({
        address: {
            user: r.user,
            server: r.server,
            device: r.device
        },
        identityKey: new Uint8Array(r.identity_key)
    }))

    const sessions = (
        db
            .prepare('SELECT user, server, device, record FROM signal_session WHERE session_id = ?')
            .all(sid) as { user: string; server: string; device: number; record: Buffer }[]
    ).map((r) => ({
        address: { user: r.user, server: r.server, device: r.device },
        // zapo's setSession encodes the SignalSessionRecord to bytes; reverse
        // it so the adapter can re-encode for the IR's proto form.
        record: decodeSignalSessionRecord(new Uint8Array(r.record))
    }))

    const senderKeys = (
        db
            .prepare(
                'SELECT group_id, sender_user, sender_server, sender_device, record FROM sender_keys WHERE session_id = ?'
            )
            .all(sid) as {
            group_id: string
            sender_user: string
            sender_server: string
            sender_device: number
            record: Buffer
        }[]
    ).map((r) => {
        const sender = {
            user: r.sender_user,
            server: r.sender_server as 'lid' | 's.whatsapp.net',
            device: r.sender_device
        }
        return {
            groupId: r.group_id,
            sender,
            record: decodeSenderKeyRecord(new Uint8Array(r.record), r.group_id, sender) as never
        }
    })

    db.close()

    return {
        credentials,
        preKeys,
        identities,
        sessions,
        senderKeys
    } as never
}

async function main(): Promise<void> {
    const inDb = resolve(IN_DB)
    const outJson = resolve(OUT_JSON)

    console.log(`[1] reading zapo WaStore from ${inDb} …`)
    const z = readZapoStore(inDb)
    console.log(
        `    me=${z.credentials.meJid ?? '?'} regId=${z.credentials.registrationInfo.registrationId} ` +
            `preKeys=${z.preKeys?.length ?? 0} sessions=${z.sessions?.length ?? 0} ` +
            `senderKeys=${z.senderKeys?.length ?? 0} identities=${z.identities?.length ?? 0}`
    )

    console.log('[2] zapo → IR → whatsmeow …')
    const ir = snapshot.from('zapo', z)
    const w = snapshot.to('whatsmeow', ir)
    console.log(
        `    regId=${w.device.registrationId} meJid=${w.device.meJid ?? '?'} ` +
            `preKeys=${w.preKeys?.length ?? 0} sessions=${w.sessions?.length ?? 0} ` +
            `senderKeys=${w.senderKeys?.length ?? 0} ` +
            `appStateSyncKeys=${w.appStateSyncKeys?.length ?? 0} ` +
            `appStateVersions=${w.appStateVersions?.length ?? 0} ` +
            `appStateMutationMacs=${w.appStateMutationMacs?.length ?? 0}`
    )

    mkdirSync(dirname(outJson), { recursive: true })
    writeFileSync(outJson, JSON.stringify(w, bytesAsBase64, 2), 'utf-8')
    console.log(`[3] ✓ wrote ${outJson}`)

    console.log('[4] spawning whatsmeow Go runner …')
    const child = spawn('go', ['run', '.'], {
        cwd: resolve('examples/whatsmeow-runner'),
        env: { ...process.env, WHATSMEOW_EXIT_MS: process.env.EXIT_MS ?? '90000' },
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
