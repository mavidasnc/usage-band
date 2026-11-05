// Durata, velocità e andamento dei prompt, accanto alla voce tkn: quanto è durato l'ultimo prompt (dal vivo durante il turno,
// subagenti compresi), i token nuovi al minuto e una sparkline del costo (o dei token) degli ultimi prompt della sessione

import type { PulsePoint } from '../types'

// Prompt nella sparkline, compreso quello corrente
export const SPARK_POINTS = 8

// Prima di questa durata la velocità non è significativa
const RATE_FROM_MS = 10_000

// Blocchi della sparkline, dal più basso al più alto
const BLOCKS = '▁▂▃▄▅▆▇█'

// Tempi dell'operazione corrente: inizio e ultima fine di un suo turno (principale o di un suo subagente)
let timing: { opId: string; startedAt: number; endedAt: number | null } | null = null

// Un'operazione nuova inizia
export const pulseStart = (opId: string, now: number) => {
  timing = { opId, startedAt: now, endedAt: null }
}

// Un turno dell'operazione è finito: la durata arriva fin qui (un subagente in background può allungarla)
export const pulseEnd = (opId: string | undefined, now: number) => {
  if (timing && timing.opId === opId) {
    timing.endedAt = Math.max(timing.endedAt ?? 0, now)
  }
}

// Durata dell'operazione: durante un turno fino ad ora, altrimenti fino all'ultima fine; null se non è quella misurata
export const pulseDuration = (opId: string, now: number, isWorking: boolean) => {
  if (!timing || timing.opId !== opId) {
    return null
  }
  const end = isWorking || timing.endedAt === null ? now : timing.endedAt
  return Math.max(end - timing.startedAt, 0)
}

const pad = (n: number) => String(n).padStart(2, '0')

// Durata leggibile: 42s, 1:42, 1:02:03
export const durationLabel = (ms: number) => {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) {
    return `${seconds}s`
  }
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

// Token al minuto (17k/min); null nei primi secondi o senza token
export const rateLabel = (tokens: number, ms: number, formatTokens: (n: number) => string) =>
  ms >= RATE_FROM_MS && tokens > 0 ? `${formatTokens(Math.round((tokens / ms) * 60_000))}/min` : null

// Sparkline dei valori, scalata sul più alto: almeno due valori, altrimenti null
export const sparkline = (values: readonly number[]) => {
  if (values.length < 2) {
    return null
  }
  const max = Math.max(...values)
  return values
    .map(value => (max > 0 ? BLOCKS[Math.min(Math.round((value / max) * (BLOCKS.length - 1)), BLOCKS.length - 1)] : BLOCKS[0]))
    .join('')
}

// Storico con un prompt in più, limitato agli ultimi (meno uno: il posto del prompt corrente)
export const pushPoint = (history: readonly PulsePoint[], point: PulsePoint) => [...history, point].slice(-(SPARK_POINTS - 1))
