/**
 * Canonical signal address. `user` is the bare LID/PN (no `@s.whatsapp.net`),
 * `device` is the libsignal device id (0 = primary). `agent`/`server` are kept
 * optional because adapters disagree on whether to encode them — when present
 * they round-trip; when absent the consumer assumes the WA defaults.
 */
export interface IrAddress {
    readonly user: string
    readonly device: number
    readonly agent?: number
    readonly server?: 'lid' | 's.whatsapp.net'
}

export interface IrGroupSender {
    readonly groupId: string
    readonly sender: IrAddress
}

export function irAddressKey(addr: IrAddress): string {
    const agent = addr.agent !== undefined ? `_${addr.agent}` : ''
    const server = addr.server ? `@${addr.server}` : ''
    return `${addr.user}${server}:${addr.device}${agent}`
}

export function irGroupSenderKey(s: IrGroupSender): string {
    return `${s.groupId}//${irAddressKey(s.sender)}`
}
