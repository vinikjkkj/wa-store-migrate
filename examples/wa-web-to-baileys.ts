/* eslint-disable */
/**
 * Reads `.auth/wa-web-dump.json` (produced by `examples/wa-web-dump.js`
 * in a logged-in WhatsApp Web tab), runs the migration through the IR,
 * and writes a baileys-compatible multi-file auth state.
 *
 *   node --import tsx examples/wa-web-to-baileys.ts
 *
 * Output goes under `.auth/baileys_from_wa-web/` ready to be fed to
 * `useMultiFileAuthState('.auth/baileys_from_wa-web')` from baileys.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { WaWebSnapshot } from '@adapters/wa-web'
import { bufferJsonReplacer, bufferJsonReviver } from '@codec/buffer-json'
import { migrate } from '@migrate'

const IN = process.env.WA_WEB_DUMP ?? '.auth/wa-web-dump-from-web.json'
const OUT_DIR = process.env.WA_WEB_OUT_DIR ?? '.auth/baileys_from_wa-web'

function fileNameForKey(type: string, id: string): string {
    // Mirror baileys' useMultiFileAuthState fixFileName:
    //   `:` → `-`, `/` → `__`. The dump key is the raw libsignal id.
    const safe = id.replace(/\//g, '__').replace(/:/g, '-')
    return `${type}-${safe}.json`
}

async function main(): Promise<void> {
    const text = readFileSync(IN, 'utf-8')
    const dump = JSON.parse(text, bufferJsonReviver) as WaWebSnapshot

    if (!dump.device.noiseKey) {
        console.error(
            'wa-web dump has no noiseKey — baileys cannot do Noise handshake without it.\n' +
                'Re-run the dumper inside the wa-web tab; if the internal-module path\n' +
                'failed, the Noise key cannot be recovered without re-pairing.'
        )
        process.exit(1)
    }

    const { data: out, losses } = migrate({
        from: 'wa-web',
        to: 'baileys',
        data: dump,
        validate: false
    })

    console.log('[wa-web → baileys] conversion summary:')
    console.log(`  registrationId: ${out.creds.registrationId}`)
    console.log(`  me.id:          ${out.creds.me?.id ?? '(none)'}`)
    console.log(`  me.lid:         ${out.creds.me?.lid ?? '(none)'}`)
    console.log(`  preKeys:        ${Object.keys(out.keys['pre-key'] ?? {}).length}`)
    console.log(`  sessions:       ${Object.keys(out.keys.session ?? {}).length}`)
    console.log(`  sender-keys:    ${Object.keys(out.keys['sender-key'] ?? {}).length}`)
    console.log(`  identities:     ${Object.keys(out.keys['identity-key'] ?? {}).length}`)
    if (losses.length > 0) {
        for (const l of losses) console.log(`  ${l.severity} ${l.domain}×${l.count}`)
    }

    // Write multi-file layout: creds.json + every key family with one file
    // per id, JSON-stringified through bufferJsonReplacer so Uint8Array
    // round-trips as { type: 'Buffer', data: '<base64>' } — exactly what
    // useMultiFileAuthState expects.
    const dir = resolve(OUT_DIR)
    await mkdir(dir, { recursive: true })

    await writeFile(
        resolve(dir, 'creds.json'),
        JSON.stringify(out.creds, bufferJsonReplacer, 2),
        'utf-8'
    )

    for (const [type, dict] of Object.entries(out.keys)) {
        if (!dict) continue
        for (const [id, value] of Object.entries(dict as Record<string, unknown>)) {
            if (value === null || value === undefined) continue
            const path = resolve(dir, fileNameForKey(type, id))
            await writeFile(path, JSON.stringify(value, bufferJsonReplacer, 2), 'utf-8')
        }
    }

    console.log(`\n✓ wrote multi-file auth state to ${dir}`)
    console.log(
        '\nNext step:\n' +
            '  import { useMultiFileAuthState } from "baileys"\n' +
            `  const { state, saveCreds } = await useMultiFileAuthState("${OUT_DIR}")\n` +
            "  // pass `state` to baileys' makeWASocket"
    )
}

void main().catch((e) => {
    console.error(e)
    process.exit(1)
})
