// Una finestra di limite: percentuale usata e, se nota, quando si azzera (ISO 8601)
export type Limit = { percent: number; resetsAt?: string }

// Ultima misura dell'uso: ogni voce manca finché il motore non ha un dato
export type Snapshot = { context?: number; fiveHour?: Limit; sevenDay?: Limit }

// Contesto stimato dopo una compattazione, finché il motore non ha di nuovo la percentuale: la percentuale intera (null se il
// conteggio non è riuscito) e l'impronta dei messaggi da cui viene
export type ContextEstimate = { percent: number | null; basis: string }

// Token di un'operazione (un prompt con le sue richieste e i suoi subagenti): ingresso nuovo (non in cache e scritto in cache),
// uscita, letti dalla cache e la parte dei subagenti, già compresa nei tre precedenti; costo della sessione all'inizio
// dell'operazione e costo dell'operazione in dollari a prezzo di listino (null dove il motore non tiene il conto)
export type Operation = {
  id: string
  input: number
  output: number
  cacheRead: number
  agents: number
  costStart: number | null
  cost: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      snapshot: Snapshot | null
      contextEstimate: ContextEstimate | null
      isHidden: boolean
      isCompact: boolean
      email: string | null
      version: string | null
      effort: string | number | null
      stepModel: string | null
      lastRequestAt: number | null
      operation: Operation | null
      isTokenDetailed: boolean
    }
  }
}
