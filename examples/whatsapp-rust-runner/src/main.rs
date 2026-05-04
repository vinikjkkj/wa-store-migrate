//! Companion to `examples/wa-web-to-rust.ts`. Opens the pre-migrated
//! `whatsapp.db`, spawns the whatsapp-rust Bot, and connects.
//!
//! Env vars:
//!   WA_DB_PATH   path to the SQLite db produced by wa-web-to-rust.ts
//!                (default: `whatsapp.db` in the cwd)
//!   EXIT_MS      auto-disconnect after this many ms (default: 0 = stay alive)
//!
//!   cargo run --manifest-path examples/whatsapp-rust-runner/Cargo.toml

use std::env;
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
        let db_path = env::var("WA_DB_PATH").unwrap_or_else(|_| "whatsapp.db".to_string());
        info!("Opening SQLite backend at {db_path}");

        let backend = match SqliteStore::new(&db_path).await {
            Ok(s) => Arc::new(s),
            Err(e) => {
                error!("Failed to open SQLite backend: {e}");
                return;
            }
        };
        info!("Backend ready, building Bot…");

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
                    _ => {}
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
