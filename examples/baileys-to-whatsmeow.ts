/* eslint-disable */
/**
 * Generates a JSON dump of the migrated session for the Go-side runner.
 * Uses the whatsmeow adapter's native output shape directly; bytes are
 * base64-encoded via a generic JSON.stringify replacer so we don't have
 * to flatten each field by hand.
 *
 *   node --import tsx examples/baileys-to-whatsmeow.ts
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import type { BaileysAuthSnapshot } from '@adapters/baileys'
import { bufferJsonReviver } from '@codec/buffer-json'
import { migrate } from '@migrate'

const BAILEYS_DIR = 'baileys/baileys_auth_info'
const OUT = '.auth/whatsmeow-dump.json'

function loadAuthState(): BaileysAuthSnapshot {
    const files = readdirSync(BAILEYS_DIR)
    const credsRaw = readFileSync(join(BAILEYS_DIR, 'creds.json'), 'utf-8')
    const creds = JSON.parse(credsRaw, bufferJsonReviver)
    const keys: Record<string, Record<string, unknown>> = {}
    for (const f of files) {
        if (f === 'creds.json') continue
        const m = /^([a-z-]+)-(.+)\.json$/i.exec(f)
        if (!m) continue
        const id = m[2]!.replace(/__/g, '/').replace(/-/g, ':')
        try {
            const text = readFileSync(join(BAILEYS_DIR, f), 'utf-8')
            const value = JSON.parse(text, bufferJsonReviver)
            if (!keys[m[1]!]) keys[m[1]!] = {}
            keys[m[1]!]![id] = value
        } catch {
            /* skip */
        }
    }
    return { creds, keys: keys as never }
}

// JSON.stringify replacer: Uint8Array → raw base64 string. Matches what the
// Go runner's `base64.StdEncoding.DecodeString` expects.
function bytesAsBase64(_key: string, value: unknown): unknown {
    if (value instanceof Uint8Array) return Buffer.from(value).toString('base64')
    return value
}

async function main(): Promise<void> {
    const data = loadAuthState()
    const { data: w, losses } = migrate({ from: 'baileys', to: 'whatsmeow', data })

    const path = resolve(OUT)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(w, bytesAsBase64, 2), 'utf-8')

    console.log(`✓ wrote ${path}`)
    console.log(
        `  registrationId=${w.device.registrationId}, meJid=${w.device.meJid ?? '(none)'}, meLid=${w.device.meLid ?? '(none)'}`
    )
    console.log(
        `  preKeys=${w.preKeys?.length ?? 0}, sessions=${w.sessions?.length ?? 0}, senderKeys=${w.senderKeys?.length ?? 0}`
    )
    console.log(
        `  identities=${w.identities?.length ?? 0}, appStateSyncKeys=${w.appStateSyncKeys?.length ?? 0}, appStateVersions=${w.appStateVersions?.length ?? 0}, mutationMacs=${w.appStateMutationMacs?.length ?? 0}`
    )
    if (losses.length > 0) {
        for (const l of losses) console.log(`  loss: ${l.severity} ${l.domain}×${l.count}`)
    }
}

void main().catch((e) => {
    console.error(e)
    process.exit(1)
})
