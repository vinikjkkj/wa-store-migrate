# Examples

Working pipelines you can copy straight into your own project. Each one
demonstrates one direction end-to-end: read from a real source, migrate
through the IR, write to a real destination.

All scripts assume the project layout (symlinks to source libs, `.auth/`
for runtime state) and are run from the repo root via `tsx`:

```sh
node --import tsx examples/<script>.ts
```

## Browser-side

| File                               | Purpose                                                                                                                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`wa-web-dump.js`](wa-web-dump.js) | Paste in the DevTools console of a logged-in `web.whatsapp.com` tab. Dumps every IndexedDB store the adapter understands, decrypts encrypted columns via wa-web's own internal modules, and triggers a JSON download. |

## Node migration scripts

| File                                                 | Direction                                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`wa-web-to-baileys.ts`](wa-web-to-baileys.ts)       | wa-web JSON dump → baileys multi-file auth (`useMultiFileAuthState`-ready)        |
| [`wa-web-to-zapo.ts`](wa-web-to-zapo.ts)             | wa-web JSON dump → zapo `WaStore` (sqlite) → live `WaClient.connect()`            |
| [`wa-web-to-rust.ts`](wa-web-to-rust.ts)             | wa-web JSON dump → whatsapp-rust SQLite (with diesel migration tracker populated) |
| [`baileys-to-whatsmeow.ts`](baileys-to-whatsmeow.ts) | baileys multi-file → JSON dump for the Go side                                    |

## Native runners

The Node migration scripts produce data; these companion programs consume it
and connect to WhatsApp's servers in the destination lib's native runtime.

### whatsmeow (Go)

[`whatsmeow-runner/`](whatsmeow-runner/) — consumes `.auth/whatsmeow-dump.json`
(output of `baileys-to-whatsmeow.ts`), populates a `whatsmeow/store/sqlstore`
container, and connects.

```sh
cd examples/whatsmeow-runner
go run .
```

### whatsapp-rust (Rust)

[`whatsapp-rust-runner/`](whatsapp-rust-runner/) — opens the SQLite database
produced by `wa-web-to-rust.ts`, spawns the whatsapp-rust `Bot`, and connects.

```sh
cd examples/whatsapp-rust-runner
WA_DB_PATH=../../.auth/wa-web-rust.db cargo run --release
```

Run from inside the runner dir so `rustup` picks up the
[`rust-toolchain.toml`](whatsapp-rust-runner/rust-toolchain.toml) and pulls
the nightly the underlying `whatsapp-rust` crate requires.

The `wa-web-to-zapo.ts` migration is its own runner (calls `WaClient.connect()`
in Node directly), so there's no separate zapo runner.

## Notes

- All scripts read/write `.auth/` (gitignored). Reset between runs:
  `rm -rf .auth/<thing>` or set `EXAMPLE_RESET_AUTH=1` where supported.
- Live-connect scripts (zapo, rust, whatsmeow-runner) **kick the live
  wa-web tab** — WhatsApp permits one companion device per primary at a
  time. Re-pair the wa-web tab afterward if you want it back.
- Auto-exit timers are configurable via env vars (`EXAMPLE_EXIT_MS`,
  `WHATSMEOW_EXIT_MS`). Default is 30s; set `0` to stay alive until Ctrl+C.
