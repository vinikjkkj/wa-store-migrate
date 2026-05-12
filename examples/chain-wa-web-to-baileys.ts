/* eslint-disable */
/**
 * Chain step: read the wa-web dump JSON directly, convert through the IR
 * via the high-level `snapshot` API, write a baileys multi-file dir, then
 * spawn baileys with that auth and verify it connects + decrypts an
 * incoming message.
 *
 *   node --import tsx examples/chain-wa-web-to-baileys.ts
 *
 * Env:
 *   WA_WEB_DUMP   wa-web dump JSON (default .auth/wa-web-dump-from-web.json)
 *   OUT_DIR       baileys multi-file output (default .auth/baileys_from_wa-web_chain)
 *   EXIT_MS       stay-alive timeout (default 60000)
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { BaileysAuthSnapshot } from '@adapters/baileys'
import type { WaWebSnapshot } from '@adapters/wa-web'
import { snapshot } from '@api'
import { bufferJsonReplacer, bufferJsonReviver } from '@codec/buffer-json'

const IN = process.env.WA_WEB_DUMP ?? '.auth/wa-web-dump-from-web.json'
const OUT_DIR = process.env.OUT_DIR ?? '.auth/baileys_from_wa-web_chain'
const EXIT_MS = Number(process.env.EXIT_MS ?? '60000')

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
    console.log(`[1] reading wa-web dump from ${IN} …`)
    const text = readFileSync(resolve(IN), 'utf-8')
    const dump = JSON.parse(text, bufferJsonReviver) as WaWebSnapshot

    if (!dump.device.noiseKey) {
        console.error('wa-web dump has no noiseKey — aborting (cannot Noise-handshake).')
        process.exit(1)
    }

    console.log('[2] converting wa-web → IR → baileys …')
    const ir = snapshot.from('wa-web', dump)
    const baileys = snapshot.to('baileys', ir)
    console.log(
        `    me=${baileys.creds.me?.id ?? '?'} regId=${baileys.creds.registrationId} ` +
            `preKeys=${Object.keys(baileys.keys['pre-key'] ?? {}).length} ` +
            `sessions=${Object.keys(baileys.keys.session ?? {}).length} ` +
            `senderKeys=${Object.keys(baileys.keys['sender-key'] ?? {}).length} ` +
            `identities=${Object.keys(baileys.keys['identity-key'] ?? {}).length}`
    )

    const outDir = resolve(OUT_DIR)
    writeBaileysMultiFile(outDir, baileys)
    console.log(`[3] wrote multi-file to ${outDir} (${readdirSync(outDir).length} files)`)

    console.log('[4] spawning baileys + connecting …')
    const baileysPath = resolve(__dirname, '..', 'baileys', 'lib', 'index.js')
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
        if (u.connection === 'open')
            console.log('[ready] connection open — READY FOR APP STATE TEST')
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
    sock.ev.on('chats.update', (updates: any[]) => {
        for (const u of updates ?? []) {
            console.log(`[chats.update] ${JSON.stringify(u)}`)
        }
    })
    sock.ev.on('chats.upsert', (chats: any[]) => {
        for (const c of chats ?? []) {
            console.log(
                `[chats.upsert] id=${c.id} unread=${c.unreadCount ?? '?'} pinned=${c.pinned ?? '?'} archived=${c.archived ?? '?'} mute=${c.muteEndTime ?? '?'}`
            )
        }
    })
    sock.ev.on('chats.delete', (ids: string[]) => {
        console.log(`[chats.delete] ${JSON.stringify(ids)}`)
    })
    sock.ev.on('contacts.update', (updates: any[]) => {
        for (const u of updates ?? []) {
            console.log(`[contacts.update] ${JSON.stringify(u)}`)
        }
    })
    sock.ev.on('messaging-history.set', (ev: any) => {
        console.log(
            `[history.set] isLatest=${ev.isLatest} chats=${ev.chats?.length ?? 0} contacts=${ev.contacts?.length ?? 0} messages=${ev.messages?.length ?? 0}`
        )
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
