//! Companion to `examples/wa-web-to-rust.ts`.
//!
//! Two modes:
//!
//!   1. With `WA_IR_JSON`: load a `WhatsappRustSnapshot` JSON via the
//!      `Backend` trait (works with any backend, not just SqliteStore),
//!      then connect.
//!   2. Without `WA_IR_JSON`: open an already-populated SQLite at
//!      `WA_DB_PATH` (default `whatsapp.db`) and connect.
//!
//! Env vars:
//!   WA_IR_JSON   path to JSON produced by `wa-web-to-rust.ts`
//!   WA_DB_PATH   path to SQLite (used only when WA_IR_JSON is unset;
//!                default `whatsapp.db`)
//!   EXIT_MS      auto-disconnect after this many ms (default: 0 = stay alive)
//!
//!   cargo run --manifest-path examples/whatsapp-rust-runner/Cargo.toml

mod import;

use std::env;
use std::fs;
use std::sync::Arc;
use std::time::Duration;

use log::{error, info};
use wacore::types::events::Event;
use whatsapp_rust::TokioRuntime;
use whatsapp_rust::bot::Bot;
use whatsapp_rust::store::SqliteStore;
use whatsapp_rust_tokio_transport::TokioWebSocketTransportFactory;
use whatsapp_rust_ureq_http_client::UreqHttpClient;

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Failed to build tokio runtime");

    rt.block_on(async {
        let backend = if let Ok(json_path) = env::var("WA_IR_JSON") {
            let db_path =
                env::var("WA_DB_PATH").unwrap_or_else(|_| "whatsapp_imported.db".to_string());
            info!("Importing {json_path} into SQLite at {db_path} via Backend trait");
            let json = match fs::read_to_string(&json_path) {
                Ok(j) => j,
                Err(e) => {
                    error!("Failed to read {json_path}: {e}");
                    return;
                }
            };
            let backend = match SqliteStore::new(&db_path).await {
                Ok(s) => Arc::new(s),
                Err(e) => {
                    error!("Failed to open SQLite backend: {e}");
                    return;
                }
            };
            if let Err(e) = import::import_dump(backend.as_ref(), &json).await {
                error!("Import failed: {e:?}");
                return;
            }
            info!("Import done; backend ready");
            backend
        } else {
            let db_path = env::var("WA_DB_PATH").unwrap_or_else(|_| "whatsapp.db".to_string());
            info!("Opening pre-populated SQLite backend at {db_path}");
            match SqliteStore::new(&db_path).await {
                Ok(s) => Arc::new(s),
                Err(e) => {
                    error!("Failed to open SQLite backend: {e}");
                    return;
                }
            }
        };

        let mut bot = Bot::builder()
            .with_backend(backend)
            .with_transport_factory(TokioWebSocketTransportFactory::new())
            .with_http_client(UreqHttpClient::new())
            .with_runtime(TokioRuntime)
            .on_event(|event, _client| async move {
                match &*event {
                    Event::Connected(_) => info!("✅ Bot connected"),
                    Event::LoggedOut(_) => error!("❌ Bot logged out"),
                    Event::PairingQrCode { code, timeout } => {
                        info!("QR code (valid {}s): {code}", timeout.as_secs())
                    }
                    other => info!("[event] {other:?}"),
                }
            })
            .build()
            .await
            .expect("Failed to build Bot");

        let client = bot.client();
        let handle = match bot.run().await {
            Ok(h) => h,
            Err(e) => {
                error!("Bot failed to start: {e}");
                return;
            }
        };

        let exit_ms: u64 = env::var("EXIT_MS").ok().and_then(|s| s.parse().ok()).unwrap_or(0);

        if exit_ms > 0 {
            tokio::select! {
                _ = handle => {}
                _ = tokio::time::sleep(Duration::from_millis(exit_ms)) => {
                    info!("auto-exit after {exit_ms}ms");
                    client.disconnect().await;
                }
                _ = tokio::signal::ctrl_c() => {
                    info!("ctrl+c → disconnecting");
                    client.disconnect().await;
                }
            }
        } else {
            tokio::select! {
                _ = handle => {}
                _ = tokio::signal::ctrl_c() => {
                    info!("ctrl+c → disconnecting");
                    client.disconnect().await;
                }
            }
        }
    });
}
