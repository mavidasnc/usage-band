import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Limit, Operation, Snapshot } from '../types'

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

// Modello dell'ultima richiesta del loop principale nel turno in corso, come lo risolve il motore (con opusplan Opus in plan mode,
// Sonnet altrimenti); null fuori da un turno o prima della prima richiesta
const stepModel = atom({ plugin: 'usage-band', key: 'stepModel' } as const, null)

// Token dell'ultima operazione (l'ultimo prompt con tutte le sue richieste e i suoi subagenti); null prima del primo prompt
const operation = atom({ plugin: 'usage-band', key: 'operation' } as const, null)

// True quando i token mostrano il dettaglio (ingresso, uscita, letti dalla cache, agenti) invece del solo totale
const isTokenDetailed = atom({ plugin: 'usage-band', key: 'isTokenDetailed' } as const, false)

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

// Numero di token abbreviato: 842, 12.4k, 1.23M
const tokenLabel = (n: number) =>
  n < 1000 ? String(n) : n < 1_000_000 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1_000_000).toFixed(2)}M`

// Token nuovi dell'operazione: ingresso (comprese le scritture in cache) e uscita. Le letture dalla cache restano fuori:
// costano una frazione di un token normale e sommate alla pari gonfierebbero il numero di un ordine di grandezza
const operationTotal = (op: Operation) => op.input + op.output

// Costo in dollari a prezzo di listino: due decimali, sotto il centesimo "<$0.01"
const costLabel = (usd: number) => (usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`)

// Quota dell'ingresso servita dalla cache, in percentuale intera; null senza ingresso
const cacheHitRate = (op: Operation) => {
  const total = op.cacheRead + op.input
  return total > 0 ? Math.round((op.cacheRead / total) * 100) : null
}

// Testo della voce token, senza l'etichetta: il totale dei token nuovi o il dettaglio (↑ ingresso, ↓ uscita, ♺ letti dalla cache
// con la quota di riuso, tra parentesi ∴ la parte dei subagenti, già compresa negli altri); in coda il costo, quando è noto
const operationText = (op: Operation, detailed: boolean) => {
  const rate = cacheHitRate(op)
  const tokens = detailed
    ? `↑${tokenLabel(op.input)} ↓${tokenLabel(op.output)} ♺ ${tokenLabel(op.cacheRead)}${rate === null ? '' : ` ${rate}%`} (∴${tokenLabel(op.agents)})`
    : tokenLabel(operationTotal(op))
  return op.cost == null ? tokens : `${tokens} · ${costLabel(op.cost)}`
}

// Costo della sessione in dollari a prezzo di listino, come lo totalizza /cost; null dove il motore non tiene il conto
const sessionCost = async ($: EngineInterface) => {
  try {
    return (await $.session.usage()).cost?.usd ?? null
  } catch {
    return null
  }
}

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

// Modello chiesto nell'ultimo cambio (/model, picker, SDK, ripresa): un alias come "opusplan", un ID, '' per il default;
// undefined finché non c'è un cambio, e allora vale l'impostazione di avvio
let requestedModel: string | undefined

// True quando il modello scelto è opusplan (Opus in plan mode, Sonnet altrimenti): $.session.model() dà solo quello effettivo.
// Precedenza come nel motore: cambio nella sessione, poi ANTHROPIC_MODEL, poi il campo model delle impostazioni
const isOpusPlan = async ($: EngineInterface) => {
  const chosen =
    requestedModel ??
    (await $.env.get('ANTHROPIC_MODEL')) ??
    (await $.settings.read().then(s => s.model, () => undefined))
  return typeof chosen === 'string' && /^opusplan\b/i.test(chosen)
}

// Durata della cache letta dalle variabili d'ambiente all'avvio: 'off' con la cache disattivata, null se non indicata
let envCacheTtl: '5m' | '1h' | 'off' | null = null

// Timer che ridisegna la barra quando l'etichetta della cache cambia, e l'ultima etichetta disegnata
let cacheTimer: { cancel: () => void } | null = null
let lastCacheLabel: string | null = null

// Operazione a cui appartiene ogni subagente (agentId → id dell'operazione), anche per gli agenti nati da altri agenti
const agentOperation = new Map<string, string>()

// Ultima operazione e ultimo formato dei token: ripiego dopo /clear, come per email e versione
let lastOperation: Operation | null = null
let lastTokenDetailed = false

// Origini dei prompt scritti dalla persona: solo questi aprono una nuova operazione
const USER_ORIGINS: string[] = ['composer', 'bridge', 'sdk']

// True tra un prompt della persona e l'inizio del turno che lo esegue
let isUserPromptPending = false

// Somma i token di una richiesta all'operazione corrente; quelli di un agente di un'operazione precedente si scartano
const addUsage = async ($: EngineInterface, agentId: string | undefined, usage: ModelUsage | null | undefined) => {
  if (!usage) {
    return
  }
  const current = await read($, operation)
  // un agente mai visto (spawn non ascoltato o ancora in corso) appartiene all'operazione corrente
  const owner = agentId === undefined ? current?.id : agentOperation.get(agentId) ?? current?.id
  if (!current || owner !== current.id) {
    return
  }
  const fresh = usage.input_tokens + usage.cache_creation_input_tokens
  const total = fresh + usage.output_tokens + usage.cache_read_input_tokens
  // Costo dell'operazione: quanto è cresciuto il costo della sessione da quando è iniziata (mai negativo, /clear lo azzera)
  const usd = await sessionCost($)
  await update($, operation, op => {
    if (!op || op.id !== current.id) {
      return op
    }
    lastOperation = {
      ...op,
      input: op.input + fresh,
      output: op.output + usage.output_tokens,
      cacheRead: op.cacheRead + usage.cache_read_input_tokens,
      agents: op.agents + (agentId === undefined ? 0 : total),
      // == null: un'operazione salvata prima della 0.11.0 non ha i campi del costo
      cost: usd === null || op.costStart == null ? (op.cost ?? null) : Math.max(usd - op.costStart, 0),
    }
    return lastOperation
  })
}

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

  // Un prompt della persona (terminale, Remote Control o SDK), non un comando slash: il prossimo turno
  // del loop principale aprirà una nuova operazione. Notifiche di task e agenti, loop e plugin non la aprono
  on('prompt.submit', async ($, e, next) => {
    if (USER_ORIGINS.includes(e.origin.kind) && !e.command && !e.isMeta) {
      isUserPromptPending = true
    }

    return next(e)
  })

  // Il turno del loop principale che segue un prompt della persona apre una nuova operazione con i token a zero;
  // gli altri (notifica di un agente in background, ripartenza senza testo) continuano quella in corso
  on('turn.start', async ($, e, next) => {
    // Un turno nuovo del loop principale: il modello della richiesta precedente non vale più finché non arriva la prima
    if (e.agentId === undefined) {
      await update($, stepModel, () => null)
    }
    if (e.agentId === undefined && isUserPromptPending) {
      isUserPromptPending = false
      const costStart = await sessionCost($)
      lastOperation = { id: e.turnId, input: 0, output: 0, cacheRead: 0, agents: 0, costStart, cost: costStart === null ? null : 0 }
      await update($, operation, () => lastOperation)
    }
    // Il turno di un subagente appartiene all'operazione in corso quando parte: vale anche per un agente
    // risvegliato da un prompt successivo, e non dipende dall'ordine con cui agent.spawn risponde
    if (e.agentId !== undefined) {
      const current = await read($, operation)
      if (current) {
        agentOperation.set(e.agentId, current.id)
      }
    }

    return next(e)
  })

  // Ogni subagente appartiene all'operazione in cui è nato: quella corrente, o quella dell'agente che l'ha lanciato
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    const owner = e.parentAgentId === undefined ? (await read($, operation))?.id : agentOperation.get(e.parentAgentId)
    if (result.agentId && owner) {
      agentOperation.set(result.agentId, owner)
    }

    return result
  })

  // Anche il riassunto della compattazione consuma token: si sommano all'operazione in cui avviene
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    await addUsage($, e.agentId, result.usage)

    return result
  })

  // Ogni richiesta al modello porta l'effort in uso: lo registra per il loop principale e lascia passare tutto;
  // alla risposta somma i suoi token all'operazione
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      await update($, effort, () => e.effort ?? null)
      await update($, stepModel, () => e.model)
      // la richiesta rinnova la cache del prompt: il countdown riparte da qui
      const now = await $.clock.now().catch(() => null)
      if (now !== null) {
        await update($, lastRequestAt, () => now)
        await scheduleCacheTick($)
      }
    }

    const result = yield* next(e)
    await addUsage($, e.agentId, result.usage)

    return result
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
    requestedModel = e.requested_model ?? ''
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
    // Con opusplan il modello effettivo è seguito da " (P)"
    // Durante un turno vale il modello della richiesta in corso (con opusplan cambia col plan mode), altrimenti quello della sessione
    const current = (e.props.isWorking ? await read($, stepModel) : null) ?? (await $.session.model())
    const model = modelLabel(current) + ((await isOpusPlan($).catch(() => false)) ? ' (P)' : '')
    const modVersion = (await read($, version)) ?? lastVersion
    const level = await read($, effort)
    const account = (await read($, email)) ?? lastEmail
    const compact = (await read($, isCompact)) || lastCompact
    const cache = await cacheState($).catch(() => null)
    const tokens = (await read($, operation)) ?? lastOperation
    const detailed = (await read($, isTokenDetailed)) || lastTokenDetailed
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

    // Token dell'ultima operazione, in testa alla riga dell'ambiente: l'intera voce ("tkn" e valori) è un pulsante che alterna
    // il totale e il dettaglio; la voce compare dopo il primo prompt
    const tokenItem = tokens ? (
      <Button
        key="tokens"
        label={`tkn ${operationText(tokens, detailed)}`}
        plain
        onPress={async () => {
          lastTokenDetailed = !detailed
          await update($, isTokenDetailed, () => lastTokenDetailed)
        }}
      />
    ) : null

    // Riga dell'ambiente: token, cartella (gialla), modello (arancio), effort (viola), email (azzurra) e versione del mod (verde acqua);
    // token, effort, email e versione compaiono quando sono noti
    const envRow = (
      <Box>
        {tokenItem}
        <Text>
          {tokens ? <Text dimColor> │ </Text> : null}
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
      </Box>
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
      : [tokens && `tkn ${operationText(tokens, detailed)}`, folder, model, level !== null && String(level), account, modVersion && `v${modVersion}`]
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
            {compact ? null : <Text dimColor> │ </Text>}
            {compact ? null : envRow}
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
