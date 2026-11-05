// Guardia sui limiti: oltre la soglia di /config del limite 5h o settimanale i subagenti non partono (anche quelli dei workflow),
// così il lavoro restante del limite va al loop principale. I prompt passano sempre. Spenta di default

import type { Limit } from '../types'
import { settings } from './options'

// Limite che fa scattare la guardia, con la sua etichetta
export type GuardHit = { label: '5h' | '7g'; limit: Limit }

const pad = (n: number) => String(n).padStart(2, '0')

// True se la guardia è accesa e il limite ha raggiunto la soglia (percentuale arrotondata, come la mostra la barra)
export const isGuarded = (limit: Limit | undefined) =>
  settings().guard && limit !== undefined && Math.round(limit.percent) >= settings().guardThreshold

// Il primo limite (prima 5h, poi 7g) oltre la soglia; null se la guardia è spenta o nessun limite la raggiunge
export const guardHit = (fiveHour: Limit | undefined, sevenDay: Limit | undefined): GuardHit | null => {
  if (isGuarded(fiveHour) && fiveHour) {
    return { label: '5h', limit: fiveHour }
  }
  if (isGuarded(sevenDay) && sevenDay) {
    return { label: '7g', limit: sevenDay }
  }
  return null
}

// Messaggio del rifiuto, che il modello riceve come errore dello strumento Agent: limite, percentuale e reset
export const guardMessage = ({ label, limit }: GuardHit) => {
  const reset = limit.resetsAt ? new Date(limit.resetsAt) : null
  const when = reset && !Number.isNaN(reset.getTime()) ? ` (reset ${pad(reset.getHours())}:${pad(reset.getMinutes())})` : ''
  return (
    `usage-band: limite ${label} al ${Math.round(limit.percent)}%${when}, oltre la soglia della guardia. ` +
    'I subagenti sono bloccati: prosegui senza subagenti, nel thread principale.'
  )
}
