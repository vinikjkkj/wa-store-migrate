/**
 * Canonical session/sender-key representation.
 *
 * All four supported libs (zapo, whatsmeow, wa-web) and the *wire* format on
 * the network use libsignal's `SessionStructure` / `SenderKeyRecord` protobuf.
 * Baileys is the outlier — it stores libsignal-node's JS object form
 * (`SessionRecord.serialize()` output) rather than proto bytes.
 *
 * To keep the IR minimal we standardize on **libsignal proto bytes**:
 * - whatsmeow / wa-web / zapo adapters round-trip with no shape change
 * - baileys adapter encodes its custom JSON form to proto bytes (and back)
 *   on the boundary, using zapo-js's `encode/decodeSignalSessionRecord`
 *   helpers as pivot.
 *
 * Skipped/out-of-order message keys round-trip cleanly only inside libs that
 * use the same per-chain key format. Across libs they may drop — capabilities
 * declare this as `lossy`.
 */

export interface IrSessionRecord {
    /** libsignal `SessionRecord` protobuf (whispertext.proto), full multi-session payload. */
    readonly proto: Uint8Array
}

export interface IrSenderKeyRecord {
    /** libsignal `SenderKeyRecord` protobuf (sender-key-record.proto). */
    readonly proto: Uint8Array
}
