import { atom, read, update } from 'claude-code'
import type { Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Limit, Snapshot } from '../types'

// Ultima misura dell'uso, letta dal disegno della barra
const snapshot = atom({ plugin: 'usage-band', key: 'snapshot' } as const, null)

// True quando la barra è nascosta con /usage-band
const isHidden = atom({ plugin: 'usage-band', key: 'isHidden' } as const, false)

// Email dell'account corrente, nota quando `claude auth status` risponde
const email = atom({ plugin: 'usage-band', key: 'email' } as const, null)

// Versione del mod, letta dal suo plugin.json all'avvio
const version = atom({ plugin: 'usage-band', key: 'version' } as const, null)

// Effort dell'ultima richiesta al modello (low, medium, high, xhigh, max o un numero), noto dopo il primo prompt
const effort = atom({ plugin: 'usage-band', key: 'effort' } as const, null)

// Larghezza massima, in colonne, della riga dei consumi (5h, 7g e ctx con i reset)
const USAGE_ROW_WIDTH = 90

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

    // Versione del mod, dal suo plugin.json (il file è del plugin, quindi leggibile)
    const manifest = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))
    await update($, version, () => manifest.version ?? null)

    // Email dell'account da `claude auth status`, senza bloccare l'avvio; se il comando non c'è
    // o fallisce resta il ripiego del hook prompt.context
    void (async () => {
      try {
        const { stdout } = await $.process.run(['claude', 'auth', 'status'])
        const found = JSON.parse(stdout).email
        if (found) {
          await update($, email, () => found)
        }
      } catch {
        // nessun comando claude nel PATH o output non JSON: l'email resta non nota
      }
    })()

    return result
  })

  // Dopo ogni turno, o quando un limite si muove di un punto: aggiorna la misura e ridisegna
  on('session.measure', async ($, e, next) => {
    await update($, snapshot, () => toSnapshot(e.context, e.rateLimits))

    return next(e)
  })

  // Ogni richiesta al modello porta l'effort in uso: lo registra per il loop principale e lascia passare tutto
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      await update($, effort, () => e.effort ?? null)
    }

    return yield* next(e)
  })

  // L'email dell'account viaggia nel blocco userEmail del contesto del primo messaggio: la legge senza modificarlo
  on('prompt.context', async ($, e, next) => {
    const result = await next(e)
    const block = result.blocks.find(b => b.name === 'userEmail')
    const found = block?.text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0]

    if (found) {
      await update($, email, () => found)
    }

    return result
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
    const model = await $.session.model()
    const modVersion = await read($, version)
    const level = await read($, effort)
    const account = await read($, email)
    const { Box, Text } = $.ui.resolve(e)

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

    // Riga dei consumi: 5h, 7g e contesto
    const usageRow = (
      <Text>
        {segment('5h', data?.fiveHour?.percent, data?.fiveHour?.resetsAt)}
        <Text dimColor> │ </Text>
        {segment('7g', data?.sevenDay?.percent, data?.sevenDay?.resetsAt)}
        <Text dimColor> │ </Text>
        {segment('ctx', data?.context)}
      </Text>
    )

    // Riga dell'ambiente: cartella (gialla), modello (arancio), effort (viola), email (azzurra) e versione del mod (verde acqua);
    // effort, email e versione compaiono quando sono noti
    const envRow = (
      <Text>
        <Text color="warning">{folder}</Text>
        <Text dimColor> │ </Text>
        <Text color="claude">{model}</Text>
        {level !== null ? <Text dimColor> │ </Text> : null}
        {level !== null ? <Text color="autoAccept">effort {level}</Text> : null}
        {account ? <Text dimColor> │ </Text> : null}
        {account ? <Text color="suggestion">{account}</Text> : null}
        {modVersion ? <Text dimColor> │ </Text> : null}
        {modVersion ? <Text color="planMode">usage-band v{modVersion}</Text> : null}
      </Text>
    )

    // Tutto su una riga se c'è posto, altrimenti due righe: una riga troppo lunga andrebbe a capo e si perderebbe la coda
    const envLength = [folder, model, level !== null && `effort ${level}`, account, modVersion && `usage-band v${modVersion}`]
      .filter(Boolean)
      .join(' │ ').length
    const isWide = USAGE_ROW_WIDTH + 3 + envLength <= (e.viewport?.columns ?? 0)

    return isWide ? (
      <Text>
        {usageRow}
        <Text dimColor> │ </Text>
        {envRow}
      </Text>
    ) : (
      <Box flexDirection="column">
        {usageRow}
        {envRow}
      </Box>
    )
  })
}
