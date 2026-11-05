// Opzioni del mod dai campi `userConfig` di plugin.json, che /config mostra come righe: preset, soglie dei colori e interruttori
// per funzione. Una modifica in /config ricarica il mod e `register` riceve i valori nuovi: `applyOptions` li normalizza una volta
// e gli altri moduli li leggono con `settings()`

import type { PluginOptions } from 'claude-code'

// Preset: quali voci mostra la barra. Full tutto; Essential consumi con ritmo, token, costo, git (solo branch), modello ed effort;
// Minimal solo la riga dei consumi
export type Preset = 'full' | 'essential' | 'minimal'

// Opzioni normalizzate
export type Settings = {
  preset: Preset
  warnAt: number
  errorAt: number
  showPace: boolean
  notifications: boolean
  showGit: boolean
}

// Valori predefiniti, gli stessi di plugin.json
export const DEFAULT_SETTINGS: Settings = {
  preset: 'full',
  warnAt: 70,
  errorAt: 90,
  showPace: true,
  notifications: true,
  showGit: true,
}

const PRESETS: readonly Preset[] = ['full', 'essential', 'minimal']

// Opzioni in vigore: i predefiniti finché `register` non le applica
let current: Settings = DEFAULT_SETTINGS

// Soglia valida: un intero tra 1 e 100, altrimenti null
const threshold = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 1), 100) : null

// Normalizza i valori di /config: preset sconosciuto → full; soglie fuori scala ricondotte tra 1 e 100; una soglia gialla non
// sotto quella rossa riporta entrambe ai predefiniti; un interruttore che non è un booleano resta acceso
export const readSettings = (options: PluginOptions): Settings => {
  const preset = PRESETS.find(p => p === options.preset) ?? DEFAULT_SETTINGS.preset
  const warn = threshold(options.warnThreshold) ?? DEFAULT_SETTINGS.warnAt
  const error = threshold(options.errorThreshold) ?? DEFAULT_SETTINGS.errorAt
  const isOrdered = warn < error
  const flag = (value: unknown) => (typeof value === 'boolean' ? value : true)
  return {
    preset,
    warnAt: isOrdered ? warn : DEFAULT_SETTINGS.warnAt,
    errorAt: isOrdered ? error : DEFAULT_SETTINGS.errorAt,
    showPace: flag(options.showPace),
    notifications: flag(options.notifications),
    showGit: flag(options.showGit),
  }
}

// Applica le opzioni ricevute da `register`
export const applyOptions = (options: PluginOptions) => {
  current = readSettings(options)
}

// Opzioni in vigore
export const settings = () => current

// Livello di una percentuale arrotondata con le soglie in vigore: 0 verde, 1 giallo, 2 rosso
export const levelFor = (percent: number) => {
  const shown = Math.round(percent)
  return shown >= current.errorAt ? 2 : shown >= current.warnAt ? 1 : 0
}

// Voci della barra che preset e interruttori lasciano visibili. Il preset decide la disposizione, gli interruttori possono solo togliere
export type Visible = {
  pace: boolean
  envRow: boolean
  toggle: boolean
  tokens: boolean
  sessionCost: boolean
  folder: boolean
  git: boolean
  gitDetail: boolean
  model: boolean
  effort: boolean
  email: boolean
  version: boolean
}

export const visibleItems = (s: Settings = current): Visible => {
  const isFull = s.preset === 'full'
  const hasEnv = s.preset !== 'minimal'
  return {
    pace: hasEnv && s.showPace,
    envRow: hasEnv,
    toggle: hasEnv,
    tokens: hasEnv,
    sessionCost: hasEnv,
    folder: isFull,
    git: hasEnv && s.showGit,
    gitDetail: isFull && s.showGit,
    model: hasEnv,
    effort: hasEnv,
    email: isFull,
    version: isFull,
  }
}
