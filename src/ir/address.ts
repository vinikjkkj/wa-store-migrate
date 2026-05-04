// `user` is the bare LID/PN, `device` the libsignal device id (0 = primary).
// `agent`/`server` are optional — adapters disagree on whether to encode them.
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
