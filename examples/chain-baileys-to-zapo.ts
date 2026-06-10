/* eslint-disable */
/**
 * Chain step: read the baileys multi-file dir (populated by
 * `chain-wa-web-to-baileys.ts`), convert through the IR via the
 * high-level `snapshot` API, populate a fresh zapo `WaStore` (sqlite),
 * then spawn `WaClient` to connect.
 *
 *   node --import tsx examples/chain-baileys-to-zapo.ts
 *
 * Env:
 *   IN_DIR       baileys multi-file source (default .auth/baileys_from_wa-web_chain)
 *   OUT_DB       zapo sqlite output (default .auth/zapo_from_baileys.sqlite)
 *   EXIT_MS      stay-alive timeout (default 90000)
 */

import { readdirSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { createSqliteStore } from '@zapo-js/store-sqlite'
import { createPinoLogger, createStore, WaClient } from 'zapo-js'
import type { WaAppStateSyncKey } from 'zapo-js/appstate'

import type { BaileysAuthSnapshot } from '@adapters/baileys'
import { snapshot } from '@api'
import { bufferJsonReviver } from '@codec/buffer-json'

const IN_DIR = process.env.IN_DIR ?? '.auth/baileys_from_wa-web_chain'
const OUT_DB = process.env.OUT_DB ?? '.auth/zapo_from_baileys.sqlite'
const SESSION_ID = 'chain-baileys-to-zapo'
const EXIT_MS = Number(process.env.EXIT_MS ?? '90000')

function readBaileysMultiFile(dir: string): BaileysAuthSnapshot {
    const credsRaw = readFileSync(join(dir, 'creds.json'), 'utf-8')
    const creds = JSON.parse(credsRaw, bufferJsonReviver)
    const keys: Record<string, Record<string, unknown>> = {}
    for (const f of readdirSync(dir)) {
        if (f === 'creds.json') continue
        const m = /^([a-z-]+)-(.+)\.json$/i.exec(f)
        if (!m) continue
        const id = m[2]!.replace(/__/g, '/').replace(/-/g, ':')
        try {
            const text = readFileSync(join(dir, f), 'utf-8')
            const value = JSON.parse(text, bufferJsonReviver)
            if (!keys[m[1]!]) keys[m[1]!] = {}
            keys[m[1]!]![id] = value
        } catch {
            /* skip */
        }
    }
    return { creds, keys: keys as never }
}

async function main(): Promise<void> {
    const inDir = resolve(IN_DIR)
    const outDb = resolve(OUT_DB)
    mkdirSync(dirname(outDb), { recursive: true })
    rmSync(outDb, { force: true })
    rmSync(`${outDb}-shm`, { force: true })
    rmSync(`${outDb}-wal`, { force: true })

    const logger = await createPinoLogger({
        level: (process.env.EXAMPLE_LOG_LEVEL ?? 'info') as any,
        pretty: true
    })

    console.log(`[1] reading baileys multi-file from ${inDir} …`)
    const baileys = readBaileysMultiFile(inDir)

    console.log('[2] baileys → IR → zapo …')
    const ir = snapshot.from('baileys', baileys)
    const z = snapshot.to('zapo', ir)
    console.log(
        `    me=${z.credentials.meJid ?? '?'} regId=${z.credentials.registrationInfo.registrationId} ` +
            `preKeys=${z.preKeys?.length ?? 0} sessions=${z.sessions?.length ?? 0} ` +
            `senderKeys=${z.senderKeys?.length ?? 0} identities=${z.identities?.length ?? 0}`
    )

    console.log('[3] creating zapo WaStore (sqlite) + populating session …')
    const store = createStore({
        backends: {
            sqlite: createSqliteStore({ path: outDb, driver: 'auto' })
        },
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
    const session = store.session(SESSION_ID)
    await session.auth.save(z.credentials)
    for (const pk of z.preKeys ?? []) await session.preKey.putPreKey(pk)
    if (z.identities?.length) {
        await session.identity.setRemoteIdentities(
            z.identities.map((i) => ({ address: i.address, identityKey: i.identityKey }))
        )
    }
    if (z.sessions?.length) {
        await session.session.setSessionsBatch(
            z.sessions.map((s) => ({ address: s.address, session: s.record as never }))
        )
    }
    for (const sk of z.senderKeys ?? []) {
        await session.senderKey.upsertSenderKey(sk.record as never)
    }
    if (z.appState) {
        await session.appState.upsertSyncKeys(z.appState.keys as readonly WaAppStateSyncKey[])
        const updates = Object.entries(z.appState.collections).map(([collection, v]) => ({
            collection: collection as never,
            version: v.version,
            hash: v.hash,
            indexValueMap: new Map(Object.entries(v.indexValueMap))
        }))
        if (updates.length > 0) await session.appState.setCollectionStates(updates)
    }
    if (z.privacyTokens?.length) {
        await session.privacyToken.upsertBatch(z.privacyTokens)
    }
    if (z.deviceLists?.length) {
        await session.deviceList.upsertUserDevicesBatch(z.deviceLists)
    }
    console.log('[3] ✓ store populated; starting client…')

    console.log('[4] WaClient.connect() …')
    const client = new WaClient(
        {
            store,
            sessionId: SESSION_ID,
            connectTimeoutMs: 15_000,
            deviceBrowser: 'Chrome',
            deviceOsDisplayName: 'Windows',
            history: { enabled: false },
            nodeQueryTimeoutMs: 30_000
        },
        logger
    )

    client.on('connection', (event: unknown) => {
        console.log('[connection]', event)
    })
    client.on('auth_qr', ({ qr, ttlMs }: { qr: string; ttlMs: number }) => {
        console.log(`[qr] ttlMs=${ttlMs} value=${qr}`)
    })
    client.on('message', (event: { message?: any; senderJid?: string; chatJid?: string }) => {
        const msg = event.message
        const text =
            msg?.conversation ??
            msg?.extendedTextMessage?.text ??
            msg?.imageMessage?.caption ??
            '(non-text)'
        console.log(
            `[message] from=${event.senderJid ?? '?'} chat=${event.chatJid ?? '?'} text=${JSON.stringify(text)}`
        )
    })

    await client.connect()
    console.log('[client] connect() resolved — waiting for events. Ctrl+C to disconnect.')

    setTimeout(() => {
        console.log(`[exit] ${EXIT_MS}ms — disconnecting`)
        void client.disconnect().finally(() => process.exit(0))
    }, EXIT_MS)
}

void main().catch((e) => {
    console.error('[chain] error:', e)
    process.exit(1)
})
