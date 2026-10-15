import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Limit, Snapshot } from '../types'

// Ultima misura dell'uso, letta dal disegno della barra
const snapshot = atom({ plugin: 'usage-band', key: 'snapshot' } as const, null)

// True quando la barra è nascosta con /usage-band
const isHidden = atom({ plugin: 'usage-band', key: 'isHidden' } as const, false)

// Email dell'account corrente, nota quando `claude auth status` risponde
const email = atom({ plugin: 'usage-band', key: 'email' } as const, null)

// Versione del mod, letta dal suo plugin.json all'avvio
const version = atom({ plugin: 'usage-band', key: 'version' } as const, null)

// True quando la barra mostra solo i consumi, senza cartella, modello, effort, email e versione
const isCompact = atom({ plugin: 'usage-band', key: 'isCompact' } as const, false)

// Effort dell'ultima richiesta al modello (low, medium, high, xhigh, max o un numero), noto dopo il primo prompt
const effort = atom({ plugin: 'usage-band', key: 'effort' } as const, null)

// Istante, in millisecondi di $.clock.now(), dell'ultima richiesta al modello del loop principale: rinnova la cache del prompt
const lastRequestAt = atom({ plugin: 'usage-band', key: 'lastRequestAt' } as const, null)

// Durata della cache del prompt riportata dal motore nei cambi di modello; null finché non arriva
const cacheTtl = atom({ plugin: 'usage-band', key: 'cacheTtl' } as const, null)

// Larghezza massima, in colonne, della riga dei consumi (5h, 7g e ctx con i reset, cache)
const USAGE_ROW_WIDTH = 106

// Durate della cache del prompt, in millisecondi
const CACHE_TTL_MS = { '5m': 5 * 60_000, '1h': 60 * 60_000 } as const

// Sotto questa soglia il countdown passa da minuti a minuti e secondi
const CACHE_SECONDS_FROM_MS = 10 * 60_000

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

// Nome leggibile del modello dal suo ID (claude-opus-5-5 → Opus 5.5, claude-3-5-sonnet-20241022 → Sonnet 3.5,
// opus → Opus; il suffisso [1m] diventa (1M)); un ID che non segue questi schemi resta com'è
const modelLabel = (id: string) => {
  const window = id.match(/\[(\w+)\]$/)?.[1]
  const suffix = window ? ` (${window.toUpperCase()})` : ''
  const base = id.replace(/\[\w+\]$/, '').trim()
  const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)
  const name = base.replace(/^claude-/, '').replace(/-\d{8}$/, '')

  // Schema attuale: famiglia, poi versione (opus-5-5, haiku-4)
  const current = name.match(/^([a-z]+)-(\d+(?:-\d+)?)$/)
  if (current) {
    return `${capitalize(current[1])} ${current[2].replace('-', '.')}${suffix}`
  }
  // Schema precedente: versione, poi famiglia (3-5-sonnet)
  const legacy = name.match(/^(\d+(?:-\d+)?)-([a-z]+)$/)
  if (legacy) {
    return `${capitalize(legacy[2])} ${legacy[1].replace('-', '.')}${suffix}`
  }
  // Alias senza versione (opus, sonnet)
  if (/^[a-z]+$/.test(name)) {
    return `${capitalize(name)}${suffix}`
  }

  return id
}

// Tempo residuo della cache: solo minuti (arrotondati per eccesso) sopra i 10 minuti, poi m:ss; a zero 'scaduta'
const cacheLabel = (remainingMs: number) => {
  if (remainingMs <= 0) {
    return 'scaduta'
  }
  if (remainingMs > CACHE_SECONDS_FROM_MS) {
    return `${Math.ceil(remainingMs / 60_000)}m`
  }
  const seconds = Math.ceil(remainingMs / 1000)
  return `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`
}

// Colore della cache in base alla quota residua: verde, giallo sotto il 25%, rosso sotto il 10%
const cacheColor = (remainingMs: number, ttlMs: number) =>
  remainingMs < ttlMs * 0.1 ? 'error' : remainingMs < ttlMs * 0.25 ? 'warning' : 'success'

// Ricava dai dati del motore le tre percentuali che la barra mostra
const toSnapshot = (context: SessionContextUsage, rateLimits: SessionRateLimit[]): Snapshot => {
  const pick = (kind: string): Limit | undefined => {
    const limit = rateLimits.find(r => r.kind === kind)
    return limit && { percent: limit.percentUsed, resetsAt: limit.resetsAt }
  }

  return { context: context.percent, fiveHour: pick('five_hour'), sevenDay: pick('seven_day') }
}

// Ultimi limiti 5h/7g visti nel processo: la variabile del modulo sopravvive a /clear (lo stato no)
// e fa da ripiego finché la sessione nuova non ha una lettura sua
let lastLimits: Pick<Snapshot, 'fiveHour' | 'sevenDay'> = {}

// Ultima email e versione note nel processo: stesso ripiego, letto dalla barra quando lo stato è vuoto
let lastEmail: string | null = null
let lastVersion: string | null = null

// Ultima scelta del pulsante dei dettagli, con lo stesso ripiego dopo /clear
let lastCompact = false

// Durata della cache letta dalle variabili d'ambiente all'avvio: 'off' con la cache disattivata, null se non indicata
let envCacheTtl: '5m' | '1h' | 'off' | null = null

// Timer che ridisegna la barra quando l'etichetta della cache cambia, e l'ultima etichetta disegnata
let cacheTimer: { cancel: () => void } | null = null
let lastCacheLabel: string | null = null

// Stato corrente della cache: durata in uso e millisecondi residui (null prima della prima richiesta), oppure null se disattivata
const cacheState = async ($: EngineInterface) => {
  const ttl = (await read($, cacheTtl)) ?? envCacheTtl ?? '1h'
  if (ttl === 'off') {
    return null
  }
  const ttlMs = CACHE_TTL_MS[ttl]
  const lastAt = await read($, lastRequestAt)
  const remainingMs = lastAt === null ? null : Math.max(lastAt + ttlMs - (await $.clock.now()), 0)

  return { ttlMs, remainingMs }
}

// Durata della cache dalle variabili di Claude Code: disattivata, forzata a 5 minuti o estesa a un'ora
const readEnvCacheTtl = async ($: EngineInterface): Promise<typeof envCacheTtl> => {
  try {
    if (await $.env.get('DISABLE_PROMPT_CACHING')) {
      return 'off'
    }
    if (await $.env.get('FORCE_PROMPT_CACHING_5M')) {
      return '5m'
    }
    if (await $.env.get('ENABLE_PROMPT_CACHING_1H')) {
      return '1h'
    }
  } catch {
    // ambiente non leggibile: vale il ripiego
  }
  return null
}

// Ridisegna la barra se l'etichetta della cache è cambiata e si risveglia quando cambierà di nuovo:
// al prossimo minuto sopra i 10 minuti, al prossimo secondo sotto; fermo con n/d, scaduta o cache disattivata.
// Va richiamata a ogni richiesta e a ogni cambio di durata
const scheduleCacheTick = async ($: EngineInterface) => {
  cacheTimer?.cancel()
  cacheTimer = null
  try {
    const state = await cacheState($)
    const remainingMs = state?.remainingMs ?? null
    const label = state === null ? null : remainingMs === null ? 'n/d' : cacheLabel(remainingMs)
    if (label !== lastCacheLabel) {
      lastCacheLabel = label
      $.ui.invalidate('ui.render')
    }
    if (remainingMs !== null && remainingMs > 0) {
      const unit = remainingMs > CACHE_SECONDS_FROM_MS ? 60_000 : 1000
      cacheTimer = $.clock.after(((remainingMs - 1) % unit) + 1, () => {
        void scheduleCacheTick($)
      })
    }
  } catch {
    // orologio non disponibile: la cache si aggiorna solo ai ridisegni del motore
  }
}

// Riempie gli atom della sessione: misura corrente, versione del mod ed email dell'account.
// Serve all'avvio e dopo /clear, che apre una sessione con lo stato vuoto senza rifare session.start
const fill = async ($: EngineInterface) => {
  const usage = await $.session.usage()
  const measured = toSnapshot(usage.context, usage.rateLimits)
  if (measured.fiveHour || measured.sevenDay) {
    lastLimits = { fiveHour: measured.fiveHour, sevenDay: measured.sevenDay }
  }
  await update($, snapshot, () => ({
    ...measured,
    fiveHour: measured.fiveHour ?? lastLimits.fiveHour,
    sevenDay: measured.sevenDay ?? lastLimits.sevenDay,
  }))

  // Versione del mod, dal suo plugin.json (il file è del plugin, quindi leggibile)
  const manifest = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))
  lastVersion = manifest.version ?? null
  await update($, version, () => lastVersion)

  // Email dell'account da `claude auth status`, senza bloccare; se il comando non c'è
  // o fallisce resta il ripiego del hook prompt.context
  void (async () => {
    try {
      const { stdout } = await $.process.run(['claude', 'auth', 'status'])
      const found = JSON.parse(stdout).email
      if (found) {
        lastEmail = found
        await update($, email, () => found)
      }
    } catch {
      // nessun comando claude nel PATH o output non JSON: l'email resta non nota
    }
  })()
}

export const register: Register = on => {
  // All'avvio (e dopo ogni reload) registra il comando e prende subito le cifre correnti
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-band',
      description: 'Mostra o nasconde la barra di uso sopra il prompt',
    })
    const result = await next(e)
    await fill($)
    envCacheTtl = await readEnvCacheTtl($)
    await scheduleCacheTick($)

    return result
  })

  // Dopo /clear lo stato della sessione riparte vuoto e session.start non scatta: lo riempie di nuovo
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source === 'clear') {
      // un errore qui non deve bloccare il /clear: al massimo la barra resta con n/d
      await fill($).catch(() => undefined)
    }

    return result
  })

  // Dopo ogni turno, o quando un limite si muove di un punto: aggiorna la misura e ridisegna
  on('session.measure', async ($, e, next) => {
    const measured = toSnapshot(e.context, e.rateLimits)
    if (measured.fiveHour || measured.sevenDay) {
      lastLimits = { fiveHour: measured.fiveHour, sevenDay: measured.sevenDay }
    }
    await update($, snapshot, () => measured)

    return next(e)
  })

  // Ogni richiesta al modello porta l'effort in uso: lo registra per il loop principale e lascia passare tutto
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      await update($, effort, () => e.effort ?? null)
      // la richiesta rinnova la cache del prompt: il countdown riparte da qui
      const now = await $.clock.now().catch(() => null)
      if (now !== null) {
        await update($, lastRequestAt, () => now)
        await scheduleCacheTick($)
      }
    }

    return yield* next(e)
  })

  // A fine turno l'evento classico Stop porta l'effort applicato (effort.level): seconda fonte,
  // per quando turn.step non lo riporta; i turni dei subagenti (agent_id) non contano
  on('classic.Stop', async ($, e, next) => {
    if (e.agent_id === undefined && e.effort) {
      await update($, effort, () => e.effort.level)
    }

    return next(e)
  })

  // I cambi di modello riportano la durata della cache del prompt usata dal motore: la ricorda per il countdown
  on('classic.PreModelSwitch', async ($, e, next) => {
    await update($, cacheTtl, () => e.cache_ttl)
    await scheduleCacheTick($)

    return next(e)
  })
  on('classic.PostModelSwitch', async ($, e, next) => {
    await update($, cacheTtl, () => e.cache_ttl)
    await scheduleCacheTick($)

    return next(e)
  })

  // L'email dell'account viaggia nel blocco userEmail del contesto del primo messaggio: la legge senza modificarlo
  on('prompt.context', async ($, e, next) => {
    const result = await next(e)
    const block = result.blocks.find(b => b.name === 'userEmail')
    const found = block?.text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0]

    if (found) {
      lastEmail = found
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

    // Dopo /clear lo stato della sessione è vuoto: per 5h/7g, versione ed email valgono gli ultimi visti nel processo
    const measured = await read($, snapshot)
    const data: Snapshot = {
      ...measured,
      fiveHour: measured?.fiveHour ?? lastLimits.fiveHour,
      sevenDay: measured?.sevenDay ?? lastLimits.sevenDay,
    }
    const folder = folderLabel(await $.session.cwd())
    const model = modelLabel(await $.session.model())
    const modVersion = (await read($, version)) ?? lastVersion
    const level = await read($, effort)
    const account = (await read($, email)) ?? lastEmail
    const compact = (await read($, isCompact)) || lastCompact
    const cache = await cacheState($).catch(() => null)
    const { Box, Button, Text } = $.ui.resolve(e)

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

    // Tempo residuo della cache del prompt: n/d prima della prima richiesta, scaduta a zero; assente con la cache disattivata
    const cacheSegment =
      cache === null ? null : cache.remainingMs === null || cache.remainingMs === 0 ? (
        <Text dimColor>cache {cache.remainingMs === null ? 'n/d' : cacheLabel(0)}</Text>
      ) : (
        <Text>
          <Text dimColor>cache </Text>
          <Text color={cacheColor(cache.remainingMs, cache.ttlMs)}>{cacheLabel(cache.remainingMs)}</Text>
        </Text>
      )

    // Riga dei consumi: 5h, 7g, contesto e cache
    const usageRow = (
      <Text>
        {segment('5h', data?.fiveHour?.percent, data?.fiveHour?.resetsAt)}
        <Text dimColor> │ </Text>
        {segment('7g', data?.sevenDay?.percent, data?.sevenDay?.resetsAt)}
        <Text dimColor> │ </Text>
        {segment('ctx', data?.context)}
        {cacheSegment ? <Text dimColor> │ </Text> : null}
        {cacheSegment}
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
        {level !== null ? <Text color="autoAccept">{level}</Text> : null}
        {account ? <Text dimColor> │ </Text> : null}
        {account ? <Text color="suggestion">{account}</Text> : null}
        {modVersion ? <Text dimColor> │ </Text> : null}
        {modVersion ? <Text color="planMode">v{modVersion}</Text> : null}
      </Text>
    )

    // Pulsante subito dopo il contesto, così non si sposta: [▸] mostra i dettagli dell'ambiente, [◂] li nasconde lasciando solo i consumi.
    // Plain con le parentesi nell'etichetta: senza plain il terminale disegnerebbe [ ◂ ] con gli spazi
    const toggle = (
      <Button
        key="details"
        label={compact ? '[▸]' : '[◂]'}
        plain
        dimColor
        onPress={async () => {
          lastCompact = !compact
          await update($, isCompact, () => lastCompact)
        }}
      />
    )

    // Consumi e pulsante, sempre insieme sulla prima riga e separati da una pipe
    const usageWithToggle = (
      <Box>
        <Text>
          {usageRow}
          <Text dimColor> │ </Text>
        </Text>
        {toggle}
      </Box>
    )

    // Tutto su una riga se c'è posto, altrimenti due righe: una riga troppo lunga andrebbe a capo e si perderebbe la coda.
    // Compatta la riga dell'ambiente sparisce e restano consumi e pulsante (" │ [▸]")
    const envLength = compact
      ? 0
      : [folder, model, level !== null && String(level), account, modVersion && `v${modVersion}`]
          .filter(Boolean)
          .join(' │ ').length + 3
    const isWide = compact || USAGE_ROW_WIDTH + 6 + envLength <= (e.viewport?.columns ?? 0)

    // Separatore dalla chat: una riga vuota e una linea tenue larga quanto la band
    const separator = <Text dimColor>{'─'.repeat(Math.max(e.props.bodyColumns ?? 0, 1))}</Text>

    return (
      <Box flexDirection="column" marginTop={1}>
        {separator}
        {isWide ? (
          <Box>
            <Text>
              {usageRow}
              <Text dimColor> │ </Text>
            </Text>
            {toggle}
            {compact ? null : (
              <Text>
                <Text dimColor> │ </Text>
                {envRow}
              </Text>
            )}
          </Box>
        ) : (
          <Box flexDirection="column">
            {usageWithToggle}
            {envRow}
          </Box>
        )}
      </Box>
    )
  })
}
