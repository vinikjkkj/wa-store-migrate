import type { StoreAdapter } from '@adapter'
import { baileysAdapter } from '@adapters/baileys'
import type { BaileysAuthSnapshot } from '@adapters/baileys/types'
import { waWebAdapter } from '@adapters/wa-web'
import type { WaWebSnapshot } from '@adapters/wa-web/types'
import { whatsappRustAdapter } from '@adapters/whatsapp-rust'
import type { WhatsappRustSnapshot } from '@adapters/whatsapp-rust/types'
import { whatsmeowAdapter } from '@adapters/whatsmeow'
import type { WhatsmeowSnapshot } from '@adapters/whatsmeow/types'
import { zapoAdapter } from '@adapters/zapo'
import type { ZapoStoreSnapshot } from '@adapters/zapo/types'
import type { LibId } from '@ir'

export const ADAPTERS = {
    baileys: baileysAdapter,
    zapo: zapoAdapter,
    'wa-web': waWebAdapter,
    whatsmeow: whatsmeowAdapter,
    'whatsapp-rust': whatsappRustAdapter
} as const satisfies Record<LibId, StoreAdapter<unknown, unknown>>

export interface LibShapeMap {
    baileys: BaileysAuthSnapshot
    zapo: ZapoStoreSnapshot
    'wa-web': WaWebSnapshot
    whatsmeow: WhatsmeowSnapshot
    'whatsapp-rust': WhatsappRustSnapshot
}

export type LibInput<L extends LibId> = LibShapeMap[L]
export type LibOutput<L extends LibId> = LibShapeMap[L]

export type AdapterRef<L extends LibId = LibId> = L | StoreAdapter<LibInput<L>, LibOutput<L>>

export function resolveAdapter<L extends LibId>(
    ref: AdapterRef<L>
): StoreAdapter<LibInput<L>, LibOutput<L>> {
    return typeof ref === 'string'
        ? (ADAPTERS[ref] as unknown as StoreAdapter<LibInput<L>, LibOutput<L>>)
        : ref
}
