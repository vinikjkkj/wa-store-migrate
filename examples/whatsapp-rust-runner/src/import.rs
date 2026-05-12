//! Imports a `WhatsappRustSnapshot`-shaped JSON (produced by
//! `examples/wa-web-to-rust.ts` via `snapshot.toJSON('whatsapp-rust', ir)`)
//! into any `Backend` impl. Bypassing the SqliteStore-specific SQL the
//! TS side used to emit means this works with custom Backends too.
//!
//! Bytes in the JSON are raw base64 (no `{type:'Buffer'}` wrapper).

use std::str::FromStr;

use anyhow::{Context, Result, anyhow};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use serde::Deserialize;

use wacore::appstate::hash::HashState;
use wacore::libsignal::protocol::KeyPair;
use wacore::store::Device;
use wacore::store::traits::{AppStateSyncKey, Backend};
use wacore_appstate::processor::AppStateMutationMAC;
use wacore_binary::jid::Jid;

#[derive(Deserialize)]
struct JsonKeyPair {
    #[serde(rename = "pubKey")]
    pub_key: String,
    #[serde(rename = "privKey")]
    priv_key: String,
}

#[derive(Deserialize)]
struct JsonDevice {
    #[serde(rename = "registrationId")]
    registration_id: u32,
    #[serde(rename = "noiseKey")]
    noise_key: JsonKeyPair,
    #[serde(rename = "identityKey")]
    identity_key: JsonKeyPair,
    #[serde(rename = "signedPreKey")]
    signed_pre_key: JsonKeyPair,
    #[serde(rename = "signedPreKeyId")]
    signed_pre_key_id: u32,
    #[serde(rename = "signedPreKeySignature")]
    signed_pre_key_signature: String,
    #[serde(rename = "advSecretKey")]
    adv_secret_key: String,
    account: Option<String>,
    pn: Option<String>,
    lid: Option<String>,
    #[serde(rename = "pushName")]
    push_name: Option<String>,
    #[serde(rename = "edgeRoutingInfo")]
    edge_routing_info: Option<String>,
    #[serde(rename = "propsHash")]
    props_hash: Option<String>,
    #[serde(rename = "nextPreKeyId")]
    next_pre_key_id: Option<u32>,
    #[serde(rename = "serverHasPrekeys")]
    server_has_prekeys: Option<bool>,
    #[serde(rename = "nctSalt")]
    nct_salt: Option<String>,
}

#[derive(Deserialize)]
struct JsonPreKey {
    #[serde(rename = "keyId")]
    key_id: u32,
    #[serde(rename = "keyPair")]
    key_pair: JsonKeyPair,
    uploaded: bool,
}

#[derive(Deserialize)]
struct JsonAddrEntry {
    address: String,
    /// `record` for sessions/sender-keys, `key` for identities.
    #[serde(alias = "record", alias = "key")]
    bytes: String,
}

#[derive(Deserialize)]
struct JsonAppStateKey {
    #[serde(rename = "keyId")]
    key_id: String,
    #[serde(rename = "keyData")]
    key_data: String,
}

#[derive(Deserialize)]
struct JsonAppStateVersion {
    name: String,
    #[serde(rename = "stateData")]
    state_data: String,
}

#[derive(Deserialize)]
struct JsonAppStateMutationMac {
    name: String,
    version: u64,
    #[serde(rename = "indexMac")]
    index_mac: String,
    #[serde(rename = "valueMac")]
    value_mac: String,
}

#[derive(Deserialize)]
struct JsonSenderKeyDevice {
    #[serde(rename = "groupJid")]
    group_jid: String,
    #[serde(rename = "deviceJid")]
    device_jid: String,
    #[serde(rename = "hasKey")]
    has_key: bool,
}

#[derive(Deserialize)]
pub struct WhatsappRustDump {
    device: JsonDevice,
    #[serde(default)]
    pre_keys: Vec<JsonPreKey>,
    #[serde(default)]
    identities: Vec<JsonAddrEntry>,
    #[serde(default)]
    sessions: Vec<JsonAddrEntry>,
    #[serde(default)]
    sender_keys: Vec<JsonAddrEntry>,
    #[serde(default)]
    sender_key_devices: Vec<JsonSenderKeyDevice>,
    #[serde(default)]
    app_state_keys: Vec<JsonAppStateKey>,
    #[serde(default)]
    app_state_versions: Vec<JsonAppStateVersion>,
    #[serde(default)]
    app_state_mutation_macs: Vec<JsonAppStateMutationMac>,
}

// camelCase wrapper that maps to the TS-side keys
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WhatsappRustDumpCamel {
    device: JsonDevice,
    #[serde(default)]
    pre_keys: Vec<JsonPreKey>,
    #[serde(default)]
    identities: Vec<JsonAddrEntry>,
    #[serde(default)]
    sessions: Vec<JsonAddrEntry>,
    #[serde(default)]
    sender_keys: Vec<JsonAddrEntry>,
    #[serde(default)]
    sender_key_devices: Vec<JsonSenderKeyDevice>,
    #[serde(default)]
    app_state_keys: Vec<JsonAppStateKey>,
    #[serde(default)]
    app_state_versions: Vec<JsonAppStateVersion>,
    #[serde(default)]
    app_state_mutation_macs: Vec<JsonAppStateMutationMac>,
}

impl From<WhatsappRustDumpCamel> for WhatsappRustDump {
    fn from(c: WhatsappRustDumpCamel) -> Self {
        WhatsappRustDump {
            device: c.device,
            pre_keys: c.pre_keys,
            identities: c.identities,
            sessions: c.sessions,
            sender_keys: c.sender_keys,
            sender_key_devices: c.sender_key_devices,
            app_state_keys: c.app_state_keys,
            app_state_versions: c.app_state_versions,
            app_state_mutation_macs: c.app_state_mutation_macs,
        }
    }
}

fn b64(s: &str) -> Result<Vec<u8>> {
    B64.decode(s).context("base64 decode")
}

fn key_pair(kp: &JsonKeyPair) -> Result<KeyPair> {
    let mut pub_bytes = b64(&kp.pub_key)?;
    // `PublicKey::deserialize` reads a libsignal-style type byte (0x05) at
    // position 0 followed by 32 bytes. The IR encodes pubkeys in both shapes:
    // some adapters strip the prefix (32 bytes), others keep it (33 bytes).
    // Add the prefix if missing.
    if pub_bytes.len() == 32 {
        pub_bytes.insert(0, 0x05);
    }
    let priv_bytes = b64(&kp.priv_key)?;
    KeyPair::from_public_and_private(&pub_bytes, &priv_bytes)
        .map_err(|e| anyhow!("invalid keypair: {e}"))
}

fn parse_dump(json: &str) -> Result<WhatsappRustDump> {
    let camel: WhatsappRustDumpCamel =
        serde_json::from_str(json).context("parse whatsapp-rust dump JSON")?;
    Ok(camel.into())
}

fn build_device(d: &JsonDevice) -> Result<Device> {
    let mut device = Device::new();
    device.registration_id = d.registration_id;
    device.noise_key = key_pair(&d.noise_key)?;
    device.identity_key = key_pair(&d.identity_key)?;
    device.signed_pre_key = key_pair(&d.signed_pre_key)?;
    device.signed_pre_key_id = d.signed_pre_key_id;

    let sig = b64(&d.signed_pre_key_signature)?;
    let sig_arr: [u8; 64] = sig.as_slice().try_into()
        .map_err(|_| anyhow!("signedPreKeySignature must be 64 bytes, got {}", sig.len()))?;
    device.signed_pre_key_signature = sig_arr;

    let adv = b64(&d.adv_secret_key)?;
    let adv_arr: [u8; 32] = adv.as_slice().try_into()
        .map_err(|_| anyhow!("advSecretKey must be 32 bytes, got {}", adv.len()))?;
    device.adv_secret_key = adv_arr;

    if let Some(acc_b64) = &d.account {
        let acc_bytes = b64(acc_b64)?;
        let acc = wacore::store::device::account_serde::from_bytes(&acc_bytes)
            .map_err(|e| anyhow!("decode account proto: {e}"))?;
        device.account = Some(acc);
    }

    if let Some(jid_str) = &d.pn {
        device.pn = Some(Jid::from_str(jid_str).map_err(|e| anyhow!("parse pn jid: {e}"))?);
    }
    if let Some(jid_str) = &d.lid {
        device.lid = Some(Jid::from_str(jid_str).map_err(|e| anyhow!("parse lid jid: {e}"))?);
    }
    if let Some(name) = &d.push_name {
        device.push_name = name.clone();
    }
    if let Some(edge) = &d.edge_routing_info {
        device.edge_routing_info = Some(b64(edge)?);
    }
    if let Some(ph) = &d.props_hash {
        device.props_hash = Some(ph.clone());
    }
    if let Some(next_id) = d.next_pre_key_id {
        device.next_pre_key_id = next_id;
    }
    if let Some(shp) = d.server_has_prekeys {
        device.server_has_prekeys = shp;
    }
    if let Some(salt) = &d.nct_salt {
        device.nct_salt = Some(b64(salt)?);
    }

    Ok(device)
}

/// Concatenate priv || pub the way `key_pair_serde` in whatsapp-rust does
/// for prekey storage in the `prekeys` table (the trait `store_prekey` takes
/// the serialized record as `&[u8]`).
fn concat_priv_pub(kp: &JsonKeyPair) -> Result<Vec<u8>> {
    let priv_bytes = b64(&kp.priv_key)?;
    let pub_bytes = b64(&kp.pub_key)?;
    let pub_raw: &[u8] = if pub_bytes.len() == 33 && pub_bytes[0] == 0x05 {
        &pub_bytes[1..]
    } else {
        &pub_bytes[..]
    };
    let mut out = Vec::with_capacity(priv_bytes.len() + pub_raw.len());
    out.extend_from_slice(&priv_bytes);
    out.extend_from_slice(pub_raw);
    Ok(out)
}

pub async fn import_dump<B: Backend>(backend: &B, json: &str) -> Result<()> {
    let dump = parse_dump(json)?;

    let device = build_device(&dump.device)?;
    backend.save(&device).await.map_err(|e| anyhow!("save device: {e}"))?;

    for pk in &dump.pre_keys {
        let record = concat_priv_pub(&pk.key_pair)?;
        backend
            .store_prekey(pk.key_id, &record, pk.uploaded)
            .await
            .map_err(|e| anyhow!("store_prekey {}: {e}", pk.key_id))?;
    }

    for id in &dump.identities {
        let key_bytes = b64(&id.bytes)?;
        let key_raw: &[u8] = if key_bytes.len() == 33 && key_bytes[0] == 0x05 {
            &key_bytes[1..]
        } else {
            &key_bytes[..]
        };
        let arr: [u8; 32] = key_raw.try_into()
            .map_err(|_| anyhow!("identity key for {} must be 32 bytes, got {}", id.address, key_raw.len()))?;
        backend
            .put_identity(&id.address, arr)
            .await
            .map_err(|e| anyhow!("put_identity {}: {e}", id.address))?;
    }

    for s in &dump.sessions {
        let bytes = b64(&s.bytes)?;
        backend
            .put_session(&s.address, &bytes)
            .await
            .map_err(|e| anyhow!("put_session {}: {e}", s.address))?;
    }

    for sk in &dump.sender_keys {
        let bytes = b64(&sk.bytes)?;
        backend
            .put_sender_key(&sk.address, &bytes)
            .await
            .map_err(|e| anyhow!("put_sender_key {}: {e}", sk.address))?;
    }

    // `sender_key_devices` lets a later rust → IR round-trip split bare records
    // back into per-device entries for device-keyed libs.
    if !dump.sender_key_devices.is_empty() {
        use std::collections::BTreeMap;
        let mut by_group: BTreeMap<String, Vec<(String, bool)>> = BTreeMap::new();
        for d in &dump.sender_key_devices {
            by_group
                .entry(d.group_jid.clone())
                .or_default()
                .push((d.device_jid.clone(), d.has_key));
        }
        for (group_jid, entries) in &by_group {
            let borrowed: Vec<(&str, bool)> =
                entries.iter().map(|(dev, has)| (dev.as_str(), *has)).collect();
            backend
                .set_sender_key_status(group_jid, &borrowed)
                .await
                .map_err(|e| anyhow!("set_sender_key_status {}: {e}", group_jid))?;
        }
    }

    for k in &dump.app_state_keys {
        let key_id = b64(&k.key_id)?;
        let key_data = b64(&k.key_data)?;
        let entry = AppStateSyncKey {
            key_data,
            fingerprint: Vec::new(),
            timestamp: 0,
        };
        backend
            .set_sync_key(&key_id, entry)
            .await
            .map_err(|e| anyhow!("set_sync_key: {e}"))?;
    }

    // App state versions: `stateData` is a bincode-encoded HashState produced
    // by the TS side. The `Backend.set_version` API takes a `HashState` value,
    // not its serialized bytes — so we decode it here.
    for v in &dump.app_state_versions {
        let bytes = b64(&v.state_data)?;
        let (state, _) = bincode::serde::decode_from_slice::<HashState, _>(
            &bytes,
            bincode::config::standard(),
        )
        .map_err(|e| anyhow!("decode HashState for {}: {e}", v.name))?;
        backend
            .set_version(&v.name, state)
            .await
            .map_err(|e| anyhow!("set_version {}: {e}", v.name))?;
    }

    // Mutation MACs — group by collection name + version, then one batched call.
    if !dump.app_state_mutation_macs.is_empty() {
        use std::collections::BTreeMap;
        let mut grouped: BTreeMap<(String, u64), Vec<AppStateMutationMAC>> = BTreeMap::new();
        for m in &dump.app_state_mutation_macs {
            let mac = AppStateMutationMAC {
                index_mac: b64(&m.index_mac)?,
                value_mac: b64(&m.value_mac)?,
            };
            grouped.entry((m.name.clone(), m.version)).or_default().push(mac);
        }
        for (key, macs) in grouped {
            let (name, version) = key;
            backend
                .put_mutation_macs(&name, version, &macs)
                .await
                .map_err(|e| anyhow!("put_mutation_macs {name} v{version}: {e}"))?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;
    use wacore::store::traits::{DeviceStore, SignalStore};
    use whatsapp_rust::store::SqliteStore;

    /// Encodes the bytes a `Device::new()` would produce into the JSON shape
    /// the importer consumes. Lets us build a minimum valid dump without
    /// hand-rolling Curve25519 keys.
    fn synth_device_json() -> serde_json::Value {
        let device = Device::new();
        let noise_pub = device.noise_key.public_key.serialize();
        let noise_priv = device.noise_key.private_key.serialize();
        let id_pub = device.identity_key.public_key.serialize();
        let id_priv = device.identity_key.private_key.serialize();
        let spk_pub = device.signed_pre_key.public_key.serialize();
        let spk_priv = device.signed_pre_key.private_key.serialize();

        json!({
            "registrationId": device.registration_id,
            "noiseKey": {
                "pubKey": B64.encode(noise_pub),
                "privKey": B64.encode(noise_priv),
            },
            "identityKey": {
                "pubKey": B64.encode(id_pub),
                "privKey": B64.encode(id_priv),
            },
            "signedPreKey": {
                "pubKey": B64.encode(spk_pub),
                "privKey": B64.encode(spk_priv),
            },
            "signedPreKeyId": 1,
            "signedPreKeySignature": B64.encode(device.signed_pre_key_signature),
            "advSecretKey": B64.encode(device.adv_secret_key),
        })
    }

    async fn open_temp_backend() -> (TempDir, SqliteStore) {
        let dir = TempDir::new().expect("tempdir");
        let db = dir.path().join("test.db");
        let backend = SqliteStore::new(db.to_str().unwrap())
            .await
            .expect("open sqlite store");
        (dir, backend)
    }

    #[tokio::test]
    async fn imports_device_only() {
        let (_dir, backend) = open_temp_backend().await;
        let payload = json!({ "device": synth_device_json() });

        import_dump(&backend, &payload.to_string()).await.expect("import");

        let loaded = backend.load().await.expect("load device");
        let loaded = loaded.expect("device should exist");
        let payload_obj = payload["device"].as_object().unwrap();
        assert_eq!(loaded.registration_id, payload_obj["registrationId"].as_u64().unwrap() as u32);
    }

    #[tokio::test]
    async fn imports_sessions_and_prekeys() {
        let (_dir, backend) = open_temp_backend().await;

        // A few synthetic prekeys. The records the importer concatenates
        // are priv || pub; we generate via Device::new() to get valid
        // 32-byte keys.
        let dummy = Device::new();
        let pk_pub = dummy.identity_key.public_key.serialize();
        let pk_priv = dummy.identity_key.private_key.serialize();

        let payload = json!({
            "device": synth_device_json(),
            "preKeys": [
                {
                    "keyId": 7,
                    "keyPair": {
                        "pubKey": B64.encode(pk_pub),
                        "privKey": B64.encode(pk_priv),
                    },
                    "uploaded": false,
                },
                {
                    "keyId": 8,
                    "keyPair": {
                        "pubKey": B64.encode(pk_pub),
                        "privKey": B64.encode(pk_priv),
                    },
                    "uploaded": true,
                },
            ],
            "sessions": [
                {
                    "address": "5511999999999@s.whatsapp.net.0",
                    "record": B64.encode([0xaa, 0xbb, 0xcc, 0xdd]),
                },
            ],
            "identities": [
                {
                    "address": "5511888888888@s.whatsapp.net.0",
                    "key": B64.encode([0u8; 32]),
                },
            ],
        });

        import_dump(&backend, &payload.to_string()).await.expect("import");

        let s = backend
            .get_session("5511999999999@s.whatsapp.net.0")
            .await
            .expect("get_session ok")
            .expect("session present");
        assert_eq!(&*s, &[0xaa, 0xbb, 0xcc, 0xdd]);

        let id = backend
            .load_identity("5511888888888@s.whatsapp.net.0")
            .await
            .expect("load_identity ok")
            .expect("identity present");
        assert_eq!(id, [0u8; 32]);

        let pk7 = backend.load_prekey(7).await.expect("load_prekey ok");
        assert!(pk7.is_some(), "prekey 7 should be present");
        let pk8 = backend.load_prekey(8).await.expect("load_prekey ok");
        assert!(pk8.is_some(), "prekey 8 should be present");
    }
}
