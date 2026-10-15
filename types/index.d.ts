// Una finestra di limite: percentuale usata e, se nota, quando si azzera (ISO 8601)
export type Limit = { percent: number; resetsAt?: string }

// Ultima misura dell'uso: ogni voce manca finché il motore non ha un dato
export type Snapshot = { context?: number; fiveHour?: Limit; sevenDay?: Limit }

// Token di un'operazione (un prompt con le sue richieste e i suoi subagenti): ingresso nuovo (non in cache e scritto in cache),
// uscita, letti dalla cache e la parte dei subagenti, già compresa nei tre precedenti
export type Operation = { id: string; input: number; output: number; cacheRead: number; agents: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      snapshot: Snapshot | null
      isHidden: boolean
      isCompact: boolean
      email: string | null
      version: string | null
      effort: string | number | null
      stepModel: string | null
      lastRequestAt: number | null
      cacheTtl: '5m' | '1h' | null
      operation: Operation | null
      isTokenDetailed: boolean
    }
  }
}
