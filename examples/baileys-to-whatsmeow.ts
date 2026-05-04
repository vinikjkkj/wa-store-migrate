/* eslint-disable */
/**
 * Generates a JSON dump of the migrated session in the shape that
 * `examples/whatsmeow-runner/main.go` expects. Bytes are encoded as raw
 * base64 strings (NOT the buffer-json wrapper) so the Go side can parse
 * them directly into []byte.
 *
 *   node --import tsx examples/baileys-to-whatsmeow.ts
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { baileysAdapter, type BaileysAuthSnapshot } from '@adapters/baileys'
import { whatsmeowAdapter } from '@adapters/whatsmeow'
import { bufferJsonReviver } from '@codec/buffer-json'
import { migrate } from '@migrate'

const BAILEYS_DIR = 'baileys/baileys_auth_info'
const OUT = '.auth/whatsmeow-dump.json'

function toB64(b: Uint8Array | undefined): string | null {
    if (!b) return null
    return Buffer.from(b).toString('base64')
}

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

async function main(): Promise<void> {
    const data = loadAuthState()
    const { data: w, losses } = migrate({
        from: baileysAdapter,
        to: whatsmeowAdapter,
        data
    })

    const out = {
        device: {
            registrationId: w.device.registrationId,
            noiseKeyPub: toB64(w.device.noiseKey.pubKey),
            noiseKeyPriv: toB64(w.device.noiseKey.privKey),
            identityKeyPub: toB64(w.device.identityKey.pubKey),
            identityKeyPriv: toB64(w.device.identityKey.privKey),
            signedPreKey: {
                keyId: w.device.signedPreKey.keyId,
                pub: toB64(w.device.signedPreKey.keyPair.pubKey),
                priv: toB64(w.device.signedPreKey.keyPair.privKey),
                signature: toB64(w.device.signedPreKey.signature)
            },
            advSecretKey: toB64(w.device.advSecretKey),
            account: w.device.account
                ? {
                      details: toB64(w.device.account.details),
                      accountSignatureKey: toB64(w.device.account.accountSignatureKey),
                      accountSignature: toB64(w.device.account.accountSignature),
                      deviceSignature: toB64(w.device.account.deviceSignature)
                  }
                : null,
            meJid: w.device.meJid ?? null,
            meLid: w.device.meLid ?? null,
            platform: w.device.platform ?? null,
            pushName: w.device.pushName ?? null
        },
        preKeys: (w.preKeys ?? []).map((k) => ({
            keyId: k.keyId,
            pub: toB64(k.keyPair.pubKey),
            priv: toB64(k.keyPair.privKey),
            uploaded: k.uploaded
        })),
        identities: (w.identities ?? []).map((i) => ({
            addr: i.addr,
            identityKey: toB64(i.identityKey)
        })),
        sessions: (w.sessions ?? []).map((s) => ({
            addr: s.addr,
            session: toB64(s.session)
        })),
        senderKeys: (w.senderKeys ?? []).map((s) => ({
            groupId: s.groupId,
            senderAddr: s.senderAddr,
            record: toB64(s.record)
        })),
        appStateSyncKeys: (w.appStateSyncKeys ?? []).map((k) => ({
            keyId: toB64(k.keyId),
            keyData: toB64(k.keyData),
            timestamp: k.timestamp,
            fingerprint: toB64(k.fingerprint)
        })),
        appStateVersions: (w.appStateVersions ?? []).map((v) => ({
            collection: v.collection,
            version: v.version,
            hash: toB64(v.hash)
        })),
        appStateMutationMacs: (w.appStateMutationMacs ?? []).map((m) => ({
            collection: m.collection,
            version: m.version,
            indexMac: toB64(m.indexMac),
            valueMac: toB64(m.valueMac)
        })),
        privacyTokens: (w.privacyTokens ?? []).map((p) => ({
            userJid: p.userJid,
            token: toB64(p.token),
            timestampS: p.timestampS
        }))
    }

    const path = resolve(OUT)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(out, null, 2), 'utf-8')

    console.log(`✓ wrote ${path}`)
    console.log(
        `  device: registrationId=${out.device.registrationId}, meJid=${out.device.meJid}, meLid=${out.device.meLid}`
    )
    console.log(
        `  preKeys=${out.preKeys.length}, sessions=${out.sessions.length}, senderKeys=${out.senderKeys.length}`
    )
    console.log(
        `  identities=${out.identities.length}, appStateSyncKeys=${out.appStateSyncKeys.length}`
    )
    console.log(
        `  appStateVersions=${out.appStateVersions.length}, mutationMacs=${out.appStateMutationMacs.length}`
    )
    if (losses.length > 0) {
        for (const l of losses) console.log(`  loss: ${l.severity} ${l.domain}×${l.count}`)
    }
}

void main().catch((e) => {
    console.error(e)
    process.exit(1)
})
