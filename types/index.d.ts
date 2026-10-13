// Una finestra di limite: percentuale usata e, se nota, quando si azzera (ISO 8601)
export type Limit = { percent: number; resetsAt?: string }

// Ultima misura dell'uso: ogni voce manca finché il motore non ha un dato
export type Snapshot = { context?: number; fiveHour?: Limit; sevenDay?: Limit }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { snapshot: Snapshot | null; isHidden: boolean }
  }
}
