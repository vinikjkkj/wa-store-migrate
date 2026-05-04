import type { IrAddress } from '@ir/address'

// IR collapses legacy `c.us` (still emitted by wa-web for self/peer JIDs)
// onto `s.whatsapp.net` — same logical PN identity, every other lib only
// knows the modern form.
export const WA_DOMAIN_PN = 's.whatsapp.net'
export const WA_DOMAIN_LID = 'lid'

export function normalizeWaServer(srv: string): 'lid' | 's.whatsapp.net' | null {
    if (srv === 'lid') return 'lid'
    if (srv === 's.whatsapp.net' || srv === 'c.us') return 's.whatsapp.net'
    return null
}

export function normalizeWaJid(jid: string): string {
    const at = jid.lastIndexOf('@')
    if (at < 0) return jid
    const srv = jid.slice(at + 1)
    if (srv === 'c.us') return `${jid.slice(0, at)}@s.whatsapp.net`
    return jid
}

/**
 * Parses both libsignal address shapes used across the libs:
 *   - `<user>[@<server>][_<agent>]:<device>`  (whatsmeow + our own)
 *   - `<user>[@<server>][_<agent>].<device>`  (libsignal-node, baileys)
 *
 * The `:`/`.` separating `<head>` from `<device>` is identified by its last
 * occurrence — mid-string `.` or `:` inside `<server>` is OK as long as the
 * device suffix uses a different delimiter.
 */
export function parseLibsignalAddress(
    s: string,
    defaults: { server?: 'lid' | 's.whatsapp.net' } = {}
): IrAddress {
    const colon = s.lastIndexOf(':')
    const dot = s.lastIndexOf('.')
    const sep = colon >= 0 ? colon : dot
    if (sep < 0) {
        throw new SyntaxError(`libsignal address: missing :device or .device in "${s}"`)
    }
    const head = s.slice(0, sep)
    const deviceStr = s.slice(sep + 1)
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
        const normalized = normalizeWaServer(srv)
        if (normalized === null) {
            throw new SyntaxError(`libsignal address: unknown server "${srv}" in "${s}"`)
        }
        server = normalized
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
