// Baileys keys sessions/identities/sender-keys by `<user>[_<agent>].<device>`,
// where agent encodes the WA domainType (LID=1, PN=0/absent). Diverges from
// the generic IR address shape — bridged here.

import type { IrAddress } from '@ir/address'

const WHATSAPP_DOMAIN_TYPE = 0
const LID_DOMAIN_TYPE = 1

function serverToDomainType(server: IrAddress['server']): number {
    return server === 'lid' ? LID_DOMAIN_TYPE : WHATSAPP_DOMAIN_TYPE
}

function domainTypeToServer(dt: number): 'lid' | 's.whatsapp.net' | undefined {
    return dt === LID_DOMAIN_TYPE ? 'lid' : undefined
}

export function toBaileysProtocolAddress(addr: IrAddress): string {
    const dt = serverToDomainType(addr.server)
    const signalUser = dt !== WHATSAPP_DOMAIN_TYPE ? `${addr.user}_${dt}` : addr.user
    return `${signalUser}.${addr.device}`
}

export function toBaileysSenderKeyName(groupId: string, sender: IrAddress): string {
    const dt = serverToDomainType(sender.server)
    const signalUser = dt !== WHATSAPP_DOMAIN_TYPE ? `${sender.user}_${dt}` : sender.user
    return `${groupId}::${signalUser}::${sender.device}`
}

export function fromBaileysProtocolAddress(key: string): IrAddress {
    const sep = key.lastIndexOf('.')
    const colonFallback = sep < 0 ? key.lastIndexOf(':') : sep
    if (colonFallback < 0) {
        throw new SyntaxError(`baileys protocol address: missing separator in "${key}"`)
    }
    const head = key.slice(0, colonFallback)
    const deviceStr = key.slice(colonFallback + 1)
    const device = Number(deviceStr)
    if (!Number.isFinite(device) || device < 0) {
        throw new SyntaxError(`baileys protocol address: bad device "${deviceStr}" in "${key}"`)
    }
    let user = head
    let server: 'lid' | 's.whatsapp.net' | undefined
    const underscore = head.lastIndexOf('_')
    if (underscore >= 0) {
        const dtStr = head.slice(underscore + 1)
        const dt = Number(dtStr)
        if (Number.isFinite(dt)) {
            user = head.slice(0, underscore)
            server = domainTypeToServer(dt)
        }
    }
    return {
        user,
        device,
        ...(server !== undefined ? { server } : {})
    }
}

export function fromBaileysSenderKeyName(
    encoded: string
): { groupId: string; sender: IrAddress } | null {
    const firstSep = encoded.indexOf('::')
    const lastSep = encoded.lastIndexOf('::')
    if (firstSep < 0 || lastSep <= firstSep) return null
    const groupId = encoded.slice(0, firstSep)
    const senderHead = encoded.slice(firstSep + 2, lastSep)
    const deviceStr = encoded.slice(lastSep + 2)
    const device = Number(deviceStr)
    if (!Number.isFinite(device)) return null
    return { groupId, sender: fromBaileysProtocolAddress(`${senderHead}.${device}`) }
}
