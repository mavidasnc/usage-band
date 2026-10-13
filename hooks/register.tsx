import { atom, read, update } from 'claude-code'
import type { Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Limit, Snapshot } from '../types'

// Ultima misura dell'uso, letta dal disegno della barra
const snapshot = atom({ plugin: 'usage-band', key: 'snapshot' } as const, null)

// True quando la barra è nascosta con /usage-band
const isHidden = atom({ plugin: 'usage-band', key: 'isHidden' } as const, false)

// Larghezza delle barre grafiche, in blocchi
const BAR_WIDTH = 10

const DAYS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']

// Colore per soglia, con le chiavi del tema: verde < 70, giallo 70-90, rosso >= 90
const colorFor = (percent: number) =>
  percent >= 90 ? 'error' : percent >= 70 ? 'warning' : 'success'

// Barra a blocchi: pieni per la parte usata, vuoti per il resto
const gauge = (percent: number) => {
  const filled = Math.round((Math.min(Math.max(percent, 0), 100) / 100) * BAR_WIDTH)
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
}

const pad = (n: number) => String(n).padStart(2, '0')

// Orario di reset: solo HH:MM se è oggi, altrimenti giorno abbreviato + HH:MM
const resetLabel = (iso: string) => {
  const date = new Date(iso)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const isToday = date.toDateString() === new Date().toDateString()
  return isToday ? time : `${DAYS[date.getDay()]} ${time}`
}

// Cartella di lavoro con la sua cartella padre (es. projects\usage-band), separatore preso dal percorso
const folderLabel = (path: string) => {
  const separator = path.includes('\\') ? '\\' : '/'
  const parts = path.split(/[\\/]/).filter(Boolean)

  return parts.length ? parts.slice(-2).join(separator) : path
}

// Ricava dai dati del motore le tre percentuali che la barra mostra
const toSnapshot = (context: SessionContextUsage, rateLimits: SessionRateLimit[]): Snapshot => {
  const pick = (kind: string): Limit | undefined => {
    const limit = rateLimits.find(r => r.kind === kind)
    return limit && { percent: limit.percentUsed, resetsAt: limit.resetsAt }
  }

  return { context: context.percent, fiveHour: pick('five_hour'), sevenDay: pick('seven_day') }
}

export const register: Register = on => {
  // All'avvio (e dopo ogni reload) registra il comando e prende subito le cifre correnti
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-band',
      description: 'Mostra o nasconde la barra di uso sopra il prompt',
    })
    const result = await next(e)
    const usage = await $.session.usage()
    await update($, snapshot, () => toSnapshot(usage.context, usage.rateLimits))

    return result
  })

  // Dopo ogni turno, o quando un limite si muove di un punto: aggiorna la misura e ridisegna
  on('session.measure', async ($, e, next) => {
    await update($, snapshot, () => toSnapshot(e.context, e.rateLimits))

    return next(e)
  })

  // /usage-band: alterna barra visibile e nascosta
  on('command.run', { command: 'usage-band' }, async $ => {
    const hidden = !(await read($, isHidden))
    await update($, isHidden, () => hidden)

    return { text: hidden ? 'Barra di uso nascosta.' : 'Barra di uso visibile.' }
  })

  // La barra sopra il prompt
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Nascosta con /usage-band o sondaggio in corso: cede il posto (senza dati resta visibile con n/d)
    if (e.props.hasSurvey || (await read($, isHidden))) {
      return next(e)
    }

    const data = await read($, snapshot)
    const folder = folderLabel(await $.session.cwd())
    const { Text } = $.ui.resolve(e)

    // Un segmento: etichetta, barra e percentuale colorate, reset opzionale
    const segment = (label: string, percent?: number, resetsAt?: string) =>
      percent === undefined ? (
        <Text dimColor>{label} n/d</Text>
      ) : (
        <Text>
          <Text dimColor>{label} </Text>
          <Text color={colorFor(percent)}>
            {gauge(percent)} {Math.round(percent)}%
          </Text>
          {resetsAt ? <Text dimColor> ↻ {resetLabel(resetsAt)}</Text> : null}
        </Text>
      )

    return (
      <Text>
        {segment('5h', data?.fiveHour?.percent, data?.fiveHour?.resetsAt)}
        <Text dimColor> │ </Text>
        {segment('7g', data?.sevenDay?.percent, data?.sevenDay?.resetsAt)}
        <Text dimColor> │ </Text>
        {segment('ctx', data?.context)}
        <Text dimColor> │ </Text>
        <Text color="warning">{folder}</Text>
      </Text>
    )
  })
}
