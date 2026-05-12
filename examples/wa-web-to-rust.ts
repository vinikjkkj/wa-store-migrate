/* eslint-disable */
/**
 * Emits a JSON dump in `WhatsappRustSnapshot` shape for the
 * `whatsapp-rust-runner` Rust binary to consume.
 *
 *   node --import tsx examples/wa-web-to-rust.ts
 *
 * Pipeline:
 *   1. Read `.auth/wa-web-dump-from-web.json`
 *   2. Convert wa-web → whatsapp-rust via the IR
 *   3. Serialize via `snapshot.toJSON('whatsapp-rust', ir)` — bytes as
 *      raw base64 so the Rust side decodes with
 *      `base64::engine::general_purpose::STANDARD.decode`.
 *   4. Write to `.auth/wa-web-rust.json`
 *
 * Then on the Rust side:
 *   WA_IR_JSON=.auth/wa-web-rust.json cargo run --manifest-path \
 *       examples/whatsapp-rust-runner/Cargo.toml
 *
 * The Rust runner imports through `whatsapp_rust::store::traits::Backend`,
 * so any Backend impl works — SqliteStore by default, or your own
 * postgres/mysql-backed implementation.
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import type { WaWebSnapshot } from '@adapters/wa-web'
import { bufferJsonReviver } from '@codec/buffer-json'
import { snapshot } from '@api'

const IN = process.env.WA_WEB_DUMP ?? '.auth/wa-web-dump-from-web.json'
const OUT = process.env.OUT_JSON ?? '.auth/wa-web-rust.json'

async function main(): Promise<void> {
    const text = readFileSync(resolve(IN), 'utf-8')
    const dump = JSON.parse(text, bufferJsonReviver) as WaWebSnapshot

    if (!dump.device.noiseKey) {
        console.error('wa-web dump has no noiseKey — aborting (cannot Noise-handshake).')
        process.exit(1)
    }

    console.log('[1] wa-web → whatsapp-rust …')
    const ir = snapshot.from('wa-web', dump)
    const rustJson = snapshot.toJSON('whatsapp-rust', ir)

    console.log(`    pn:                  ${rustJson.device.pn ?? '(none)'}`)
    console.log(`    lid:                 ${rustJson.device.lid ?? '(none)'}`)
    console.log(`    registrationId:      ${rustJson.device.registrationId}`)
    console.log(`    preKeys:             ${rustJson.preKeys?.length ?? 0}`)
    console.log(`    identities:          ${rustJson.identities?.length ?? 0}`)
    console.log(`    sessions:            ${rustJson.sessions?.length ?? 0}`)
    console.log(`    senderKeys:          ${rustJson.senderKeys?.length ?? 0}`)
    console.log(`    appStateKeys:        ${rustJson.appStateKeys?.length ?? 0}`)
    console.log(`    appStateVersions:    ${rustJson.appStateVersions?.length ?? 0}`)
    console.log(`    appStateMutationMacs:${rustJson.appStateMutationMacs?.length ?? 0}`)
    console.log(`    tcTokens:            ${rustJson.tcTokens?.length ?? 0}`)
    console.log(`    deviceRegistry:      ${rustJson.deviceRegistry?.length ?? 0}`)

    const outPath = resolve(OUT)
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, JSON.stringify(rustJson, null, 2), 'utf-8')

    console.log(`\n✓ wrote ${outPath}`)
    console.log('\nNext step:')
    console.log(`  WA_IR_JSON=${outPath} \\`)
    console.log(`      cargo run --manifest-path examples/whatsapp-rust-runner/Cargo.toml`)
}

void main().catch((e) => {
    console.error(e)
    process.exit(1)
})
