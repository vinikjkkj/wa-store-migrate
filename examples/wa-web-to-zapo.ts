/* eslint-disable */
/**
 * Live test of the wa-web → zapo migration: reads the wa-web dump JSON,
 * converts via the IR, pre-populates a fresh sqlite-backed `WaStore`, and
 * launches `WaClient` to connect to WhatsApp's servers.
 *
 *   node --import tsx examples/wa-web-to-zapo.ts
 *
 * sqlite db is written to `.auth/state-from-wa-web.sqlite` (gitignored).
 * EXAMPLE_RESET_AUTH=1 wipes it before running. EXAMPLE_EXIT_MS=N exits
 * after N ms (default 0 = stay alive).
 *
 * Note: connecting will kick the live wa-web tab (WhatsApp only allows one
 * companion device per primary). Re-pair the wa-web tab afterwards if you
 * want it back.
 */

import { mkdir, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { createSqliteStore } from '@zapo-js/store-sqlite'

import { WaClient, createPinoLogger, createStore, type LogLevel } from 'zapo-js'
import type { WaAppStateSyncKey } from 'zapo-js/appstate'

import type { WaWebSnapshot } from '@adapters/wa-web'
import { bufferJsonReviver } from '@codec/buffer-json'
import { migrate } from '@migrate'

const DUMP_PATH = process.env.WA_WEB_DUMP ?? '.auth/wa-web-dump-from-web.json'
const SESSION_ID = 'wa-web-migrated'

async function main(): Promise<void> {
    const authPath = resolve(process.cwd(), '.auth', 'state-from-wa-web.sqlite')
    await mkdir(dirname(authPath), { recursive: true })
    if (process.env.EXAMPLE_RESET_AUTH === '1') {
        await rm(authPath, { force: true })
        console.log(`[info] auth reset: ${authPath}`)
    }

    const logger = await createPinoLogger({
        level: (process.env.EXAMPLE_LOG_LEVEL ?? 'info') as LogLevel,
        pretty: true
    })

    console.log('[step 1] loading wa-web dump…')
    const text = readFileSync(resolve(DUMP_PATH), 'utf-8')
    const dump = JSON.parse(text, bufferJsonReviver) as WaWebSnapshot

    if (!dump.device.noiseKey) {
        console.error(
            '[step 1] wa-web dump has no noiseKey — zapo cannot Noise-handshake.\n' +
                'Re-run the dumper inside the wa-web tab; the noise key is recovered\n' +
                'via the internal-module path only when the tab is fully logged in.'
        )
        process.exit(1)
    }

    console.log('[step 1] wa-web → zapo conversion…')
    const { data: zapoData, losses } = migrate({
        from: 'wa-web',
        to: 'zapo',
        data: dump,
        validate: false
    })
    console.log(
        `[step 1] ✓ converted: identities=${zapoData.identities?.length ?? 0}, ` +
            `preKeys=${zapoData.preKeys?.length ?? 0}, sessions=${zapoData.sessions?.length ?? 0}, ` +
            `senderKeys=${zapoData.senderKeys?.length ?? 0}`
    )
    console.log(`[step 1] meJid=${zapoData.credentials.meJid ?? '(none)'}`)
    console.log(`[step 1] meLid=${zapoData.credentials.meLid ?? '(none)'}`)
    if (losses.length > 0) {
        for (const l of losses) console.log(`[step 1] loss: ${l.severity} ${l.domain}×${l.count}`)
    }

    console.log('[step 2] building zapo WaStore (sqlite)…')
    const store = createStore({
        backends: {
            sqlite: createSqliteStore({ path: authPath, driver: 'auto' })
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

    console.log('[step 3] pre-populating store with the migrated session…')
    const session = store.session(SESSION_ID)

    await session.auth.save(zapoData.credentials)

    for (const pk of zapoData.preKeys ?? []) await session.preKey.putPreKey(pk)

    if (zapoData.identities && zapoData.identities.length > 0) {
        await session.identity.setRemoteIdentities(
            zapoData.identities.map((i) => ({ address: i.address, identityKey: i.identityKey }))
        )
    }

    if (zapoData.sessions) {
        await session.session.setSessionsBatch(
            zapoData.sessions.map((s) => ({ address: s.address, session: s.record as never }))
        )
    }

    for (const sk of zapoData.senderKeys ?? []) {
        await session.senderKey.upsertSenderKey(sk.record as never)
    }

    if (zapoData.appState) {
        await session.appState.upsertSyncKeys(
            zapoData.appState.keys as readonly WaAppStateSyncKey[]
        )
        const updates = Object.entries(zapoData.appState.collections).map(([collection, v]) => ({
            collection: collection as never,
            version: v.version,
            hash: v.hash,
            indexValueMap: new Map(Object.entries(v.indexValueMap))
        }))
        if (updates.length > 0) await session.appState.setCollectionStates(updates)
    }

    if (zapoData.privacyTokens && zapoData.privacyTokens.length > 0) {
        await session.privacyToken.upsertBatch(zapoData.privacyTokens)
    }

    if (zapoData.deviceLists && zapoData.deviceLists.length > 0) {
        await session.deviceList.upsertUserDevicesBatch(zapoData.deviceLists)
    }

    console.log('[step 3] ✓ store populated; starting client…')

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
    client.on('auth_paired', ({ credentials }: { credentials: { meJid?: string } }) => {
        console.log(`[paired] meJid=${credentials.meJid ?? 'unknown'}`)
    })
    client.on('message', (event: { message?: unknown; senderJid?: string; chatJid?: string }) => {
        const msg = event.message as
            | { conversation?: string; extendedTextMessage?: { text?: string } }
            | undefined
        const text = msg?.conversation ?? msg?.extendedTextMessage?.text
        console.log(
            `[message] from=${event.senderJid ?? '?'} chat=${event.chatJid ?? '?'} text=${text ?? '(no text)'}`
        )
    })

    await client.connect()
    console.log('[client] connect() resolved — waiting for events. Ctrl+C to disconnect.')

    const autoExitMs = Number(process.env.EXAMPLE_EXIT_MS ?? '0')
    if (Number.isFinite(autoExitMs) && autoExitMs > 0) {
        setTimeout(() => void shutdown(client, 0), autoExitMs)
    }

    process.on('SIGINT', () => void shutdown(client, 0))
    process.on('SIGTERM', () => void shutdown(client, 0))
}

async function shutdown(client: WaClient, code: number): Promise<void> {
    try {
        await client.disconnect()
    } catch {
        /* ignore */
    }
    process.exit(code)
}

void main().catch((err) => {
    console.error(err)
    process.exit(1)
})
