// Ritmo di consumo dei limiti 5h e 7g: confronta la percentuale usata con la parte di finestra già trascorsa e, al ritmo medio
// della finestra, prevede quando il limite si esaurirebbe

import type { Limit } from '../types'

// Durata delle finestre di limite, in millisecondi
export const WINDOW_MS = { fiveHour: 5 * 3_600_000, sevenDay: 7 * 86_400_000 } as const

// Scarto, in punti percentuali, oltre il quale il consumo è più veloce (▲) o più lento (▼) del tempo che passa
const TREND_MARGIN = 5

// Quota di finestra che deve essere trascorsa prima di prevedere l'esaurimento: all'inizio la media non è affidabile
const FORECAST_FROM = 0.1

// Ritmo di un limite: tendenza rispetto al tempo trascorso e istante previsto di esaurimento (in millisecondi), se arriva prima del reset
export type Pace = { trend: 'up' | 'down' | null; exhaustAt: number | null }

const NO_PACE: Pace = { trend: null, exhaustAt: null }

// Ritmo di un limite all'istante `now`; senza reset noto, fuori dalla finestra o a limite già esaurito nessuna indicazione
export const pace = (limit: Limit | undefined, windowMs: number, now: number): Pace => {
  const resetAt = limit?.resetsAt ? Date.parse(limit.resetsAt) : Number.NaN
  if (!limit || Number.isNaN(resetAt) || now >= resetAt || limit.percent >= 100) {
    return NO_PACE
  }
  const elapsed = now - (resetAt - windowMs)
  if (elapsed <= 0) {
    return NO_PACE
  }
  const expected = (elapsed / windowMs) * 100
  const gap = limit.percent - expected
  const trend = gap > TREND_MARGIN ? 'up' : gap < -TREND_MARGIN ? 'down' : null

  // Al ritmo medio della finestra (percentuale usata sul tempo trascorso): quando si arriverebbe a 100
  let exhaustAt: number | null = null
  if (limit.percent > 0 && elapsed >= windowMs * FORECAST_FROM) {
    const at = now + ((100 - limit.percent) * elapsed) / limit.percent
    exhaustAt = at < resetAt ? at : null
  }

  return { trend, exhaustAt }
}

// Simbolo della tendenza: ▲ più veloce del tempo, ▼ più lento, nulla se in linea
export const trendSymbol = (trend: Pace['trend']) => (trend === 'up' ? '▲' : trend === 'down' ? '▼' : '')
