/* eslint-disable */
/**
 * wa-web → JSON dumper (logged-in tab).
 *
 * Run in the DevTools console of a *logged-in* `web.whatsapp.com` tab.
 * Produces `wa-web-dump.json` shaped for the `waWebAdapter.toCanonical()`
 * input in `wa-store-migrate`.
 *
 * Sources walked:
 *   - `signal-storage` IDB:
 *       - signal-meta-store (REG_ID, STATIC_PUBKEY/PRIVKEY [encrypted],
 *         LAST_SPK_ID, ADV_SIGNED_IDENTITY)
 *       - signed-prekey-store, prekey-store, identity-store, session-store,
 *         senderkey-store
 *   - `localStorage`:
 *       - WANoiseInfo (encrypted with wawc_db_enc-derived key —
 *         decrypted via wa-web's own modules accessed through `__d`)
 *       - last-wid-md, WALid, me-display-name
 *
 * Two decryption layers handled:
 *   1. STATIC_PUBKEY/PRIVKEY: `{encKey: CryptoKey, value: ArrayBuffer}`.
 *      The non-extractable AES-CTR CryptoKey lives in the row itself, so
 *      anyone reading IDB can decrypt by calling crypto.subtle.decrypt
 *      with that same key + zero counter (per WAWebSignalCommonUtils).
 *   2. WANoiseInfo: AES-CBC ciphertexts encrypted with a key derived from
 *      `wawc_db_enc.keys[0]` + `WAWebEncKeySalt` + `companion_enc_static`.
 *      We don't know `companion_enc_static` from outside, so we ride the
 *      live tab and call `WAWebUserPrefsInfoStore.waNoiseInfo.get()`
 *      directly — it returns the in-memory decrypted form.
 *
 * Output JSON uses `{ type: 'Buffer', data: '<base64>' }` byte wrappers
 * so `bufferJsonReviver` (re-exported from wa-store-migrate) can revive
 * them on the Node side.
 *
 * Usage:
 *   await waWebDump()        // returns dump object + offers download
 */

;(async () => {
    function bytesToB64(bytes) {
        if (!bytes) return null
        let u
        if (bytes instanceof Uint8Array) u = bytes
        else if (bytes instanceof ArrayBuffer) u = new Uint8Array(bytes)
        else if (typeof bytes === 'string') {
            // wa-web stores some byte fields as JS "binary strings" (each
            // char = 1 byte, codepoints 0..255). Convert directly.
            u = Uint8Array.from(bytes, (c) => c.charCodeAt(0))
        } else return null
        const chunks = []
        const STEP = 0x8000
        for (let i = 0; i < u.length; i += STEP) {
            chunks.push(String.fromCharCode.apply(null, u.subarray(i, i + STEP)))
        }
        return btoa(chunks.join(''))
    }

    function bufWrap(bytes) {
        const b = bytesToB64(bytes)
        return b == null ? null : { type: 'Buffer', data: b }
    }

    /**
     * Recursively convert a wa-web structured object (with ArrayBuffer/
     * Uint8Array/binary-string leaves) into a JSON-friendly tree where
     * every byte field becomes `{ type: 'Buffer', data: '<base64>' }`.
     * Keeps non-byte fields (numbers, plain objects, arrays) as-is.
     */
    function deepBufWrap(value) {
        if (value == null) return value
        if (value instanceof Uint8Array || value instanceof ArrayBuffer) return bufWrap(value)
        if (Array.isArray(value)) return value.map(deepBufWrap)
        if (typeof value === 'object') {
            // Skip wa-web's internal protobufjs marker
            const out = {}
            for (const k of Object.keys(value)) {
                if (k === '$$unknownFieldCount') continue
                out[k] = deepBufWrap(value[k])
            }
            return out
        }
        return value
    }

    function open(name) {
        return new Promise((res, rej) => {
            const req = indexedDB.open(name)
            req.onsuccess = () => res(req.result)
            req.onerror = () => rej(req.error)
        })
    }

    function getAll(db, store) {
        return new Promise((res, rej) => {
            const tx = db.transaction(store, 'readonly')
            const req = tx.objectStore(store).getAll()
            req.onsuccess = () => res(req.result)
            req.onerror = () => rej(req.error)
        })
    }

    /**
     * Decrypt an `{encKey, value}` AES-CTR registration-material wrapper
     * exactly as `WAWebSignalCommonUtils.decryptRegistrationMaterial` does.
     */
    async function decryptRegMaterial(obj) {
        if (!obj || !obj.encKey || !obj.value) return null
        const counter = new Uint8Array(16)
        const ct = obj.value instanceof Uint8Array ? obj.value : new Uint8Array(obj.value)
        const out = await crypto.subtle.decrypt(
            { name: 'AES-CTR', length: 128, counter },
            obj.encKey,
            ct
        )
        return new Uint8Array(out)
    }

    /**
     * Try to access a wa-web internal module. wa-web uses Facebook's `__d`
     * module system; the require shim is exposed (in different forms) on
     * different builds. We probe several entry points.
     */
    function getWaModule(name) {
        // 1. globalThis.require (rare but seen on dev builds)
        try {
            if (typeof require === 'function') return require(name)
        } catch {}
        // 2. The bundle's internal __d: register a sentinel module that
        //    closes over the parent require fn, then call it.
        try {
            if (typeof __d === 'function') {
                let captured
                const sentinel = '__waDumpProbe_' + Math.random().toString(36).slice(2)
                __d(sentinel, [name], function (_t, _n, _r, _o) {
                    captured = _o(name)
                })
                // Force-load via a fake top-level require if needed.
                // The most common Comet pattern: __d.require / __d.r
                if (typeof __d.require === 'function') {
                    captured = captured ?? __d.require(name)
                }
                if (captured) return captured
            }
        } catch {}
        return null
    }

    async function getNoiseInfoViaInternalModule() {
        const infoStore = getWaModule('WAWebUserPrefsInfoStore')
        if (!infoStore?.waNoiseInfo?.get) return null
        try {
            const decrypted = await infoStore.waNoiseInfo.get()
            if (!decrypted?.staticKeyPair) return null
            return {
                pubKey: new Uint8Array(decrypted.staticKeyPair.pubKey),
                privKey: new Uint8Array(decrypted.staticKeyPair.privKey)
            }
        } catch (e) {
            console.warn('[wa-web-dump] internal module getNoiseInfo failed:', e)
            return null
        }
    }

    /**
     * Fallback: brute-decrypt WANoiseInfo. Tries each base key in
     * `wawc_db_enc.keys` against both candidate `info` values (placeholder
     * single byte 0 vs every plausible companion_enc_static — the only
     * provenance we have is wa-web's IDB itself, so we can't actually
     * recover companion_enc_static. This branch only succeeds for tabs
     * that haven't completed `success` yet, which means it's basically
     * useless for already-logged-in tabs).
     */
    async function getNoiseInfoFallback() {
        const saltJson = localStorage.getItem('WAWebEncKeySalt')
        const noiseJson = localStorage.getItem('WANoiseInfo')
        const ivJson = localStorage.getItem('WANoiseInfoIv')
        if (!saltJson || !noiseJson || !ivJson) return null

        const saltBytes = Uint8Array.from(atob(JSON.parse(saltJson)), (c) => c.charCodeAt(0))
        const noiseObj = JSON.parse(noiseJson)
        const ivs = JSON.parse(ivJson).map((b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0)))
        const encPub = Uint8Array.from(atob(noiseObj.pubKey), (c) => c.charCodeAt(0))
        const encPriv = Uint8Array.from(atob(noiseObj.privKey), (c) => c.charCodeAt(0))

        const dbEnc = await open('wawc_db_enc')
        const baseRows = await getAll(dbEnc, 'keys')
        dbEnc.close()
        if (!baseRows?.length) return null

        for (const row of baseRows) {
            const baseKey = row.key
            // Only the placeholder info=Uint8Array(1) path can be reproduced
            // without server-supplied companion_enc_static.
            const candidateInfos = [new Uint8Array(1)]
            for (const info of candidateInfos) {
                try {
                    const aesKey = await crypto.subtle.deriveKey(
                        { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info },
                        baseKey,
                        { name: 'AES-CBC', length: 128 },
                        false,
                        ['decrypt']
                    )
                    const pub = await crypto.subtle.decrypt(
                        { name: 'AES-CBC', iv: ivs[1] },
                        aesKey,
                        encPub
                    )
                    const priv = await crypto.subtle.decrypt(
                        { name: 'AES-CBC', iv: ivs[2] },
                        aesKey,
                        encPriv
                    )
                    return { pubKey: new Uint8Array(pub), privKey: new Uint8Array(priv) }
                } catch {
                    /* try next combo */
                }
            }
        }
        return null
    }

    async function getNoiseKey() {
        const viaModule = await getNoiseInfoViaInternalModule()
        if (viaModule) {
            console.log('[wa-web-dump] noise key obtained via WAWebUserPrefsInfoStore (decrypted)')
            return viaModule
        }
        const viaFallback = await getNoiseInfoFallback()
        if (viaFallback) {
            console.log(
                '[wa-web-dump] noise key obtained via fallback HKDF (placeholder info path)'
            )
            return viaFallback
        }
        console.warn(
            '[wa-web-dump] FAILED to obtain noise key. Internal module access did not work and the fallback can only decrypt unrotated bootstrap state.\n' +
                'If you need the noise key, paste this dumper BEFORE the wa-web app fully completes its first login (no `success` stanza yet) — but typically you want a logged-in tab, where the internal-module path is the right one.\n' +
                'Continuing without noiseKey; baileys will need a re-pair to fill it in.'
        )
        return null
    }

    function parseAddress(addr) {
        // wa-web identity-store / session-store / senderId use libsignal-node
        // format `<jid>.<device>` (e.g. `102513101521058@lid.0`). The dot
        // separates the device suffix; we split on the LAST dot.
        const dot = addr.lastIndexOf('.')
        const head = dot >= 0 ? addr.slice(0, dot) : addr
        const device = dot >= 0 ? Number(addr.slice(dot + 1)) : 0
        // head is `<user>@<server>` (server may be `lid`, `s.whatsapp.net`,
        // `c.us`, etc.). If no `@`, default to `s.whatsapp.net`.
        const jid = head.includes('@') ? head : head + '@s.whatsapp.net'
        return { jid, device: Number.isFinite(device) ? device : 0 }
    }

    function parseSenderKeyName(name) {
        // wa-web format: `<groupId>::<senderJid>.<device>`
        const sep = name.indexOf('::')
        if (sep < 0) return null
        const groupId = name.slice(0, sep)
        const senderPart = name.slice(sep + 2)
        const { jid, device } = parseAddress(senderPart)
        return { groupId, senderJid: jid, senderDevice: device }
    }

    /**
     * Pull all rows from a `model-storage` table by name. The wa-web wrapper
     * (`Schema*.get<X>Table().all()`) handles transparent decrypt of any
     * `addEncryptedColumn` columns using the in-memory keys derived from the
     * `success` companion bytes — so this only works in a fully logged-in
     * tab. Returns `[]` if the schema module isn't loadable.
     */
    async function getModelTable(schemaModuleName, tableGetterName) {
        const mod = getWaModule(schemaModuleName)
        const getter = mod?.[tableGetterName]
        if (typeof getter !== 'function') return []
        try {
            const rows = await getter().all()
            return Array.isArray(rows) ? rows : []
        } catch (e) {
            console.warn(`[wa-web-dump] ${schemaModuleName}.${tableGetterName}().all() failed:`, e)
            return []
        }
    }

    function toUint8(v) {
        if (v == null) return null
        if (v instanceof Uint8Array) return v
        if (v instanceof ArrayBuffer) return new Uint8Array(v)
        if (typeof v === 'object' && v.buffer instanceof ArrayBuffer) {
            return new Uint8Array(v.buffer, v.byteOffset ?? 0, v.byteLength ?? v.buffer.byteLength)
        }
        if (typeof v === 'string') {
            return Uint8Array.from(v, (c) => c.charCodeAt(0))
        }
        return null
    }

    // ── Run ──────────────────────────────────────────────────────────────

    const sg = await open('signal-storage')

    const [meta, identity, prekey, signedPrekey, session, senderkey] = await Promise.all([
        getAll(sg, 'signal-meta-store'),
        getAll(sg, 'identity-store'),
        getAll(sg, 'prekey-store'),
        getAll(sg, 'signed-prekey-store'),
        getAll(sg, 'session-store'),
        getAll(sg, 'senderkey-store')
    ])
    sg.close()

    const metaMap = {}
    for (const r of meta) metaMap[r.key] = r.value

    // STATIC_PUBKEY/PRIVKEY are AES-CTR-wrapped — decrypt via the encKey
    // CryptoKey stored in the same row.
    const staticPub = await decryptRegMaterial(metaMap.signal_static_pubkey)
    const staticPriv = await decryptRegMaterial(metaMap.signal_static_privkey)

    // The noise key (different from the libsignal static identity above).
    const noise = await getNoiseKey()

    // ADV signed identity is stored as a structured protobufjs object —
    // walk it to convert each ArrayBuffer leaf into a Buffer wrapper.
    const advSignedIdentity = metaMap.adv_signed_identity
        ? deepBufWrap(metaMap.adv_signed_identity)
        : null

    // ── model-storage tables ────────────────────────────────────────────
    // wa-web stores app-state, contacts, and TC tokens in a *separate* IDB
    // (`model-storage`) keyed differently and partially encrypted. The
    // wa-web wrappers (`WAWebSchema*`) transparently decrypt encrypted
    // columns using the in-memory keys, so we read through them.
    const [
        syncKeysRows,
        collectionVersionRows,
        syncActionsRows,
        contactRows,
        tcTokenRows,
        deviceListRows,
        messageRows,
        userPrefsRows
    ] = await Promise.all([
        getModelTable('WAWebSchemaSyncKeys', 'getSyncKeysTable'),
        getModelTable('WAWebSchemaCollectionVersion', 'getCollectionVersionTable'),
        getModelTable('WAWebSchemaSyncActions', 'getSyncActionsTable'),
        getModelTable('WAWebSchemaContact_DO_NOT_USE_DIRECTLY', 'getContactTable'),
        getModelTable('WAWebSchemaOrphanTcToken', 'getOrphanTcTokenTable'),
        getModelTable('WAWebSchemaDeviceList', 'getDeviceListTable'),
        getModelTable('WAWebSchemaMessage', 'getMessageTable'),
        getModelTable('WAWebSchemaUserPrefs', 'getUserPrefsTable')
    ])

    // Look up specific user-prefs entries we care about. These are scalar
    // values keyed by string (e.g. `WAADVSecretKey` is the 32-byte ADV
    // master secret used for ADV_SIGN — required by baileys for device
    // additions). Stored in the same `model-storage` IDB.
    const userPrefs = {}
    for (const row of userPrefsRows) {
        if (row?.key) userPrefs[String(row.key)] = row.value
    }

    // Fall back to raw IDB if the wrapper-based lookup turned up empty
    // (some builds tree-shake the schema module, others register it lazily).
    // `user-prefs` has no encrypted columns so raw read is safe.
    if (userPrefsRows.length === 0) {
        try {
            const ms = await open('model-storage')
            if (ms.objectStoreNames.contains('user-prefs')) {
                const rows = await getAll(ms, 'user-prefs')
                for (const row of rows) {
                    if (row?.key) userPrefs[String(row.key)] = row.value
                }
                console.log(`[wa-web-dump] user-prefs raw fallback read ${rows.length} rows`)
            }
            ms.close()
        } catch (e) {
            console.warn('[wa-web-dump] user-prefs raw fallback failed:', e)
        }
    }

    // ADV secret note: wa-web wipes the ADV secret immediately after the
    // initial pair-success (see `WAWebCompanionRegUtils.clearADVSecretKey`
    // call during FIRST_CONNECT). The secret is only needed to verify the
    // pair-success HMAC — once `signedIdentity` is stored, every other
    // ADV operation uses `accountSignatureKey`/`deviceSignature`, never
    // the secret. Migrating to baileys/zapo/whatsmeow with an empty ADV
    // secret therefore produces a fully working session; only re-pairing
    // would fail without it (and re-pairing is a primary-device operation
    // anyway). Pull it if it happens to still be there (rare), otherwise
    // leave empty.
    let advSecretKey = null
    try {
        const v = await getWaModule('WAWebUserPrefsMultiDevice')?.getADVSecretKey?.()
        if (typeof v === 'string') advSecretKey = Uint8Array.from(atob(v), (c) => c.charCodeAt(0))
        else if (v) advSecretKey = toUint8(v)
    } catch {}
    if (!advSecretKey) {
        console.log(
            '[wa-web-dump] advSecretKey not available — wa-web wipes it post-pairing. ' +
                'Session will still migrate correctly; only future re-pair operations would need it.'
        )
    }

    // sync-keys → IR appStateSyncKeys.
    // After `convertToSyncKeyFromRow`, rows expose decoded `keyId` (ArrayBuffer)
    // + `keyData` (ArrayBuffer/Uint8Array). We don't import the converter,
    // so we coerce here directly — both fields come out of dexie as the raw
    // wrapped form and `toUint8()` normalizes either shape.
    const appStateSyncKeys = syncKeysRows
        .map((r) => {
            const keyId = toUint8(r.keyId)
            const keyData = toUint8(r.keyData)
            if (!keyId || !keyData) return null
            return {
                keyId: bufWrap(keyId),
                keyData: bufWrap(keyData),
                timestamp: r.timestamp ?? 0,
                ...(r.fingerprint ? { fingerprint: r.fingerprint } : {}),
                ...(r.keyEpoch !== undefined ? { keyEpoch: r.keyEpoch } : {})
            }
        })
        .filter(Boolean)

    // sync-actions, grouped by collection, build indexMac → valueMac map.
    // Each row carries `{collection, indexMac, valueMac, ...}`. Convert
    // indexMac to base64 (matches the IR's `indexValueMap` key shape).
    const indexValueByCollection = new Map()
    for (const a of syncActionsRows) {
        const im = toUint8(a.indexMac)
        const vm = toUint8(a.valueMac)
        if (!a.collection || !im || !vm) continue
        const map = indexValueByCollection.get(a.collection) ?? {}
        map[bytesToB64(im)] = bufWrap(vm)
        indexValueByCollection.set(a.collection, map)
    }

    const appStateVersions = collectionVersionRows
        .map((r) => {
            const ltHash = toUint8(r.ltHash)
            if (!r.collection || !ltHash) return null
            return {
                collection: r.collection,
                version: r.version ?? 0,
                hash: bufWrap(ltHash),
                indexValueMap: indexValueByCollection.get(r.collection) ?? {}
            }
        })
        .filter(Boolean)

    // contact rows. `id` is the WID string ("<num>@<server>" or LID form).
    // wa-web's contact entries are huge (50+ columns) — we keep only the
    // identity-relevant subset that the IR understands.
    const contacts = contactRows
        .map((r) => {
            if (!r.id) return null
            const out = { jid: String(r.id) }
            if (r.name) out.displayName = String(r.name)
            if (r.pushname) out.pushName = String(r.pushname)
            if (r.verifiedName) out.verifiedName = String(r.verifiedName)
            if (r.phoneNumber) out.phoneNumber = String(r.phoneNumber)
            return out
        })
        .filter(Boolean)

    // orphan-tc-token rows. `tcToken` is decrypted by the wrapper.
    const privacyTokens = tcTokenRows
        .map((r) => {
            if (!r.chatId) return null
            const token = toUint8(r.tcToken)
            if (!token) return null
            return {
                jid: String(r.chatId),
                token: bufWrap(token),
                timestampMs: (r.tcTokenTimestamp ?? 0) * 1000
            }
        })
        .filter(Boolean)

    // device-list rows. Each row's `id` is the user side of the JID:
    //   `<user>` (PN, no @-suffix) | `<user>@lid`. We rebuild the canonical
    //   JID and pass through the raw `devices[].id` numbers; the adapter
    //   expands them to full `<user>:<dev>@<server>` jids.
    const deviceLists = deviceListRows
        .map((r) => {
            if (!r.id || r.deleted) return null
            const idStr = String(r.id)
            const userJid = idStr.includes('@') ? idStr : `${idStr}@s.whatsapp.net`
            const deviceIds = Array.isArray(r.devices)
                ? r.devices
                      .map((d) => (typeof d === 'object' && d ? d.id : d))
                      .filter((n) => Number.isFinite(n))
                : []
            return {
                userJid,
                deviceIds,
                timestampMs: (r.timestamp ?? 0) * 1000
            }
        })
        .filter(Boolean)

    // message rows → messageSecrets. wa-web stores secrets inline in each
    // message; we deserialize via WAWebDBMessageSerialization.messageFromDbRow
    // which produces `{ id: WAWebMsgKey, messageSecret? }` (and many other
    // fields we don't care about). Skip rows without a secret.
    //
    // For very large accounts this can mean iterating 100k+ rows. Done
    // synchronously after `.all()` already pulled everything into memory —
    // dexie can't stream encrypted columns lazily.
    const messageSecrets = []
    if (messageRows.length > 0) {
        const ser = getWaModule('WAWebDBMessageSerialization')
        const fromRow = ser?.messageFromDbRow
        if (typeof fromRow === 'function') {
            for (const row of messageRows) {
                let msg
                try {
                    msg = fromRow(row)
                } catch {
                    continue
                }
                const secret = toUint8(msg?.messageSecret)
                if (!secret) continue
                const key = msg?.id ?? msg?.msgKey
                const messageId = key?.id != null ? String(key.id) : null
                if (!messageId) continue
                const remote = key?.remote
                const participant = key?.participant
                const author = msg?.author
                const senderJid =
                    participant?.toString?.() ?? author?.toString?.() ?? remote?.toString?.() ?? ''
                const chatJid = remote?.toString?.()
                if (!senderJid) continue
                messageSecrets.push({
                    messageId,
                    senderJid,
                    ...(chatJid ? { chatJid } : {}),
                    secret: bufWrap(secret)
                })
            }
        } else {
            console.warn(
                '[wa-web-dump] WAWebDBMessageSerialization.messageFromDbRow not loadable — skipping messageSecrets'
            )
        }
    }

    const lastWidMd = (() => {
        try {
            return JSON.parse(localStorage.getItem('last-wid-md') ?? 'null')
        } catch {
            return null
        }
    })()
    const lid = (() => {
        try {
            return JSON.parse(localStorage.getItem('WALid') ?? 'null')
        } catch {
            return null
        }
    })()
    const meDisplayName = (() => {
        try {
            return JSON.parse(localStorage.getItem('me-display-name') ?? 'null')
        } catch {
            return null
        }
    })()

    function widToJid(wid) {
        if (!wid || typeof wid !== 'string') return null
        // wa-web format: `<user>.<agent>:<device>@<server>`
        // Convert to baileys-style `<user>:<device>@<server>`.
        const at = wid.lastIndexOf('@')
        const head = at >= 0 ? wid.slice(0, at) : wid
        const server = at >= 0 ? wid.slice(at + 1) : 's.whatsapp.net'
        const colon = head.indexOf(':')
        const userAndAgent = colon >= 0 ? head.slice(0, colon) : head
        const device = colon >= 0 ? Number(head.slice(colon + 1)) : 0
        const dot = userAndAgent.indexOf('.')
        const user = dot >= 0 ? userAndAgent.slice(0, dot) : userAndAgent
        return `${user}:${device}@${server}`
    }

    const dump = {
        device: {
            registrationId: metaMap.signal_reg_id ?? null,
            noiseKey: noise
                ? { pubKey: bufWrap(noise.pubKey), privKey: bufWrap(noise.privKey) }
                : null,
            identityKey:
                staticPub && staticPriv
                    ? { pubKey: bufWrap(staticPub), privKey: bufWrap(staticPriv) }
                    : null,
            signedPreKey: signedPrekey[signedPrekey.length - 1]
                ? {
                      keyId: signedPrekey[signedPrekey.length - 1].keyId,
                      keyPair: {
                          pubKey: bufWrap(signedPrekey[signedPrekey.length - 1].keyPair.pubKey),
                          privKey: bufWrap(signedPrekey[signedPrekey.length - 1].keyPair.privKey)
                      },
                      signature: bufWrap(signedPrekey[signedPrekey.length - 1].signature)
                  }
                : null,
            advSecretKey: advSecretKey ? bufWrap(advSecretKey) : bufWrap(new Uint8Array(0)),
            // wa-web stores `account` as a decoded protobufjs object
            // (`{$$unknownFieldCount, details, accountSignatureKey,
            // accountSignature, deviceSignature}`). Pass through after
            // recursive bufWrap.
            account: advSignedIdentity,
            meJid: widToJid(lastWidMd),
            meLid: widToJid(lid),
            meDisplayName: meDisplayName ?? null,
            platform: 'web'
        },
        preKeys: prekey.map((r) => ({
            keyId: r.keyId,
            keyPair: { pubKey: bufWrap(r.keyPair.pubKey), privKey: bufWrap(r.keyPair.privKey) }
        })),
        identities: identity.map((r) => {
            const { jid, device } = parseAddress(r.identifier)
            return { jid, device, identityKey: bufWrap(r.identityKey) }
        }),
        // wa-web's `session` column is a decoded zapo-style SignalSessionRecord
        // object — passes straight through after recursive bufWrap. Same for
        // sender-keys (`{senderKeyStates: [...]}`).
        sessions: session.map((r) => {
            const { jid, device } = parseAddress(r.address)
            return { jid, device, session: deepBufWrap(r.session) }
        }),
        senderKeys: senderkey
            .map((r) => {
                const parsed = parseSenderKeyName(r.senderKeyName)
                if (!parsed) return null
                return {
                    groupId: parsed.groupId,
                    senderJid: parsed.senderJid,
                    senderDevice: parsed.senderDevice,
                    record: deepBufWrap(r.senderKey)
                }
            })
            .filter(Boolean),
        appStateSyncKeys,
        appStateVersions,
        privacyTokens,
        contacts,
        deviceLists,
        messageSecrets
    }

    console.log('[wa-web-dump] summary:', {
        regId: dump.device.registrationId,
        meJid: dump.device.meJid,
        meLid: dump.device.meLid,
        hasNoiseKey: !!dump.device.noiseKey,
        hasIdentityKey: !!dump.device.identityKey,
        hasSignedPreKey: !!dump.device.signedPreKey,
        preKeys: dump.preKeys.length,
        sessions: dump.sessions.length,
        senderKeys: dump.senderKeys.length,
        identities: dump.identities.length,
        appStateSyncKeys: dump.appStateSyncKeys.length,
        appStateVersions: dump.appStateVersions.length,
        privacyTokens: dump.privacyTokens.length,
        contacts: dump.contacts.length,
        deviceLists: dump.deviceLists.length,
        messageSecrets: dump.messageSecrets.length
    })

    if (!dump.device.noiseKey) {
        console.warn(
            '[wa-web-dump] noiseKey is null — baileys will not be able to resume the Noise XX handshake.\n' +
                'Workaround: re-pair the destination as a fresh companion (you keep the libsignal identity + sessions, only the noise transport key gets rotated).'
        )
    }

    const json = JSON.stringify(dump, null, 2)
    console.log('[wa-web-dump] JSON ready (' + json.length + ' chars). Saving to disk…')
    try {
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'wa-web-dump.json'
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        console.log('[wa-web-dump] download triggered as wa-web-dump.json')
    } catch (e) {
        console.warn('[wa-web-dump] auto-download failed; copy/paste manually:', e)
    }

    // Also expose to window for manual access if needed.
    window.__waWebDumpResult = dump
    console.log('[wa-web-dump] result also available at window.__waWebDumpResult')
})().catch((e) => console.error('[wa-web-dump] failed:', e))
