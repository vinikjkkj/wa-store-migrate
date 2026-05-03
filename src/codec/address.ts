import type { IrAddress } from '@ir/address'

/**
 * libsignal address strings used by baileys: `<user>[@<server>][_<agent>]:<device>`.
 *
 * Examples:
 *   `5511999999999.0:1`           PN, primary device
 *   `5511999999999@lid:2`         LID
 *   `5511999999999_1:1`           with agent (rare)
 *
 * The trailing `.0` group exists in older formats and is stripped.
 */
export function parseLibsignalAddress(
    s: string,
    defaults: { server?: 'lid' | 's.whatsapp.net' } = {}
): IrAddress {
    const colon = s.lastIndexOf(':')
    if (colon < 0) throw new SyntaxError(`libsignal address: missing :device in "${s}"`)
    const head = s.slice(0, colon)
    const deviceStr = s.slice(colon + 1)
    const device = Number(deviceStr)
    if (!Number.isFinite(device) || device < 0) {
        throw new SyntaxError(`libsignal address: bad device "${deviceStr}" in "${s}"`)
    }

    let user = head
    let agent: number | undefined
    let server: 'lid' | 's.whatsapp.net' | undefined = defaults.server

    const at = user.indexOf('@')
    if (at >= 0) {
        const srv = user.slice(at + 1)
        user = user.slice(0, at)
        if (srv === 'lid') server = 'lid'
        else if (srv === 's.whatsapp.net') server = 's.whatsapp.net'
        else throw new SyntaxError(`libsignal address: unknown server "${srv}" in "${s}"`)
    }

    const underscore = user.indexOf('_')
    if (underscore >= 0) {
        const agentStr = user.slice(underscore + 1)
        user = user.slice(0, underscore)
        const a = Number(agentStr)
        if (!Number.isFinite(a)) {
            throw new SyntaxError(`libsignal address: bad agent "${agentStr}" in "${s}"`)
        }
        agent = a
    }

    const dot = user.indexOf('.')
    if (dot >= 0) user = user.slice(0, dot)

    return {
        user,
        device,
        ...(agent !== undefined ? { agent } : {}),
        ...(server !== undefined ? { server } : {})
    }
}

export function toLibsignalAddress(addr: IrAddress): string {
    const agent = addr.agent !== undefined ? `_${addr.agent}` : ''
    const server = addr.server ? `@${addr.server}` : ''
    return `${addr.user}${server}${agent}:${addr.device}`
}
