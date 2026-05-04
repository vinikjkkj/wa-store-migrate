// libsignal `SessionStructure` / `SenderKeyRecord` proto bytes — the wire
// format zapo/whatsmeow/wa-web persist directly. baileys uses a custom JSON
// form; its adapter encodes to/from proto on the boundary.

export interface IrSessionRecord {
    readonly proto: Uint8Array
}

export interface IrSenderKeyRecord {
    readonly proto: Uint8Array
}
