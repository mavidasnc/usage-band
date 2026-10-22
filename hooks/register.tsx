import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  ModelUsage,
  Register,
  SessionContextUsage,
  SessionMessage,
  SessionRateLimit,
  SessionUsage,
} from 'claude-code'

import type { Limit, Operation, Snapshot } from '../types'

// Ultima misura dell'uso, letta dal disegno della barra
const snapshot = atom({ plugin: 'usage-band', key: 'snapshot' } as const, null)

// Contesto stimato dopo l'ultima compattazione; null se non ce n'è una o se una risposta ha riportato la percentuale vera
const contextEstimate = atom({ plugin: 'usage-band', key: 'contextEstimate' } as const, null)

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

// Prompt che il clic sul contesto scrive nella casella, con la percentuale intera
const compactPrompt = (percent: number) =>
  `Il tuo contesto è al ${Math.round(percent)}%, valuta se è necessario eseguire il comando /compact. ` +
  'Se sì scrivimi il comando con le indicazioni su cosa mantenere e cosa pulire e, se serve, ' +
  'scrivi nella memoria e/o nello scratchpad ciò che ti serve per proseguire'

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
  if (current?.[1] && current[2]) {
    return `${capitalize(current[1])} ${current[2].replace('-', '.')}${suffix}`
  }
  // Schema precedente: versione, poi famiglia (3-5-sonnet)
  const legacy = name.match(/^(\d+(?:-\d+)?)-([a-z]+)$/)
  if (legacy?.[1] && legacy[2]) {
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

// Colore della cache in base alla quota residua: verde, giallo sotto il 25%, rosso sotto il 10% e da scaduta
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

// Stima del contesto avviata e non ancora finita, come «sessione:impronta»: i disegni nel frattempo non ne avviano un'altra uguale
let estimating: string | null = null

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

// Righe finali lette da un transcript troppo grande per $.fs.read (4 MiB): bastano a trovare l'ultima risposta
const TRANSCRIPT_TAIL_LINES = 100

// Dimensione oltre la quale $.fs.read rifiuta un file
const FS_READ_LIMIT = 4 * 1024 * 1024

// Sessione per cui il disegno della barra ha già avviato il countdown: dopo /resume nessun altro evento lo avvia
let tickedSessionId: string | null = null

// Lettura del transcript della sessione: istante dell'ultima risposta del thread principale, una volta per sessione
let transcriptLoad: { sessionId: string; promise: Promise<number | null>; at?: number | null } | null = null

// Testo del transcript di una sessione, o solo le sue ultime righe se è troppo grande; null se non si trova.
// Il file è <cartella di configurazione>/projects/<cartella del progetto con ogni carattere non alfanumerico come '-'>/<id>.jsonl
const readTranscript = async ($: EngineInterface, sessionId: string) => {
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) || (home ? `${home}/.claude` : null)
  if (!configDir) {
    return null
  }
  // La cartella del progetto è quella di partenza: la radice della sessione, o la cartella di lavoro
  const folders = [...new Set([await $.session.root(), await $.session.cwd()])]
  for (const folder of folders) {
    const path = `${configDir}/projects/${folder.replace(/[^a-zA-Z0-9]/g, '-')}/${sessionId}.jsonl`
    const stat = await $.fs.stat(path).catch(() => null)
    if (stat?.kind !== 'file') {
      continue
    }
    if (stat.size < FS_READ_LIMIT) {
      return $.fs.read(path)
    }
    // Troppo grande per una lettura intera: le ultime righe con il comando del sistema
    const isWindows = /^[a-zA-Z]:[\\/]/.test(path)
    const argv = isWindows
      ? ['powershell', '-NoProfile', '-Command', `Get-Content -LiteralPath '${path.replace(/'/g, "''")}' -Tail ${TRANSCRIPT_TAIL_LINES} -Encoding UTF8`]
      : ['tail', '-n', String(TRANSCRIPT_TAIL_LINES), path]
    return (await $.process.run(argv)).stdout
  }
  return null
}

// Email dell'account dal file di configurazione di Claude Code (oauthAccount.emailAddress), dove il login la registra:
// <CLAUDE_CONFIG_DIR>/.claude.json, altrimenti <home>/.claude.json; null se il file manca, è troppo grande o non la contiene
const readConfigEmail = async ($: EngineInterface) => {
  try {
    const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
    const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
    const base = configDir || home
    if (!base) {
      return null
    }
    const path = `${base}/.claude.json`
    const stat = await $.fs.stat(path).catch(() => null)
    if (stat?.kind !== 'file' || stat.size >= FS_READ_LIMIT) {
      return null
    }
    const found = JSON.parse(await $.fs.read(path))?.oauthAccount?.emailAddress
    return typeof found === 'string' && found ? found : null
  } catch {
    // file non leggibile o non JSON: l'email resta non nota
    return null
  }
}

// Istante, in millisecondi, dell'ultima risposta del thread principale nel transcript: le righe dei subagenti
// (isSidechain) e le risposte sintetiche del motore non contano; null se non c'è o il transcript non si legge
const readLastResponseAt = async ($: EngineInterface, sessionId: string) => {
  try {
    const text = await readTranscript($, sessionId)
    const lines = text?.split('\n') ?? []
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]
      if (!line?.includes('"type":"assistant"')) {
        continue
      }
      try {
        const row = JSON.parse(line)
        const at = Date.parse(row.timestamp)
        if (row.type === 'assistant' && !row.isSidechain && row.message?.model !== '<synthetic>' && !Number.isNaN(at)) {
          return at
        }
      } catch {
        // riga tagliata in testa alle ultime righe: si passa alla precedente
      }
    }
  } catch {
    // transcript non leggibile: la cache resta n/d fino alla prossima richiesta
  }
  return null
}

// Ultima risposta della sessione corrente letta dal transcript (conversazione ripresa). La prima chiamata per sessione
// avvia la lettura; con wait false (durante il disegno) non la attende e finché non finisce vale null
const transcriptResponseAt = async ($: EngineInterface, wait: boolean) => {
  const sessionId = await $.session.id()
  if (transcriptLoad?.sessionId !== sessionId) {
    const load: NonNullable<typeof transcriptLoad> = { sessionId, promise: readLastResponseAt($, sessionId) }
    void load.promise.then(at => {
      load.at = at
    })
    transcriptLoad = load
  }
  return wait ? transcriptLoad.promise : (transcriptLoad.at ?? null)
}

// Stato corrente della cache: durata in uso e millisecondi residui (null prima della prima richiesta), oppure null se disattivata.
// Senza una richiesta in questa sessione vale l'ultima risposta del transcript (conversazione ripresa); wait come per transcriptResponseAt
const cacheState = async ($: EngineInterface, wait = true) => {
  const ttl = envCacheTtl ?? '1h'
  if (ttl === 'off') {
    return null
  }
  const ttlMs = CACHE_TTL_MS[ttl]
  const lastAt = (await read($, lastRequestAt)) ?? (await transcriptResponseAt($, wait).catch(() => null))
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
// Va richiamata a ogni richiesta
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

// Effort salvato da /effort nelle impostazioni dell'utente (settings.json nella cartella di configurazione di Claude Code):
// quello del modello indicato, altrimenti quello generale; null se il file non c'è o non lo riporta
const readSettingsEffort = async ($: EngineInterface, model: string) => {
  try {
    const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
    const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
    const base = configDir || (home && `${home}/.claude`)
    if (!base) {
      return null
    }
    const path = `${base}/settings.json`
    const stat = await $.fs.stat(path).catch(() => null)
    if (stat?.kind !== 'file' || stat.size >= FS_READ_LIMIT) {
      return null
    }
    const settings = JSON.parse(await $.fs.read(path))
    const level = settings?.modelSettings?.[model]?.effortLevel ?? settings?.effortLevel
    return typeof level === 'string' && level ? level : null
  } catch {
    // file non leggibile o non JSON: l'effort resta quello della prossima richiesta al modello
    return null
  }
}

// Dopo un /effort la barra mostra subito il livello in vigore, senza attendere la prossima richiesta al modello. Il motore non
// passa ai plugin il testo della risposta del comando, quindi il livello viene da settings.json, dove /effort lo salva:
// un livello che il modello non ha non viene salvato e resta quello di prima. Fa eccezione max, che /effort applica solo
// alla sessione senza salvarlo: chiesto quello, la barra lo mostra (la prossima richiesta al modello lo conferma o lo corregge)
const refreshEffort = async ($: EngineInterface, requested: string) => {
  const level = requested === 'max' ? requested : await readSettingsEffort($, await $.session.model())
  if (level) {
    await update($, effort, () => level)
    $.ui.invalidate('ui.render')
  }
}

// Impronta dei messaggi del loop principale: quanti sono e un hash (djb2) di ruoli e testi. Distingue due compattazioni di fila,
// che possono lasciare lo stesso ultimo messaggio (provato dal vivo)
const messagesBasis = (messages: SessionMessage[]) => {
  let hash = 5381
  for (const message of messages) {
    const text = `${message.role}:${message.text}\n`
    for (let i = 0; i < text.length; i++) {
      hash = (hash * 33 + text.charCodeAt(i)) | 0
    }
  }
  return `${messages.length}:${hash}`
}

// Stima il contesto dai messaggi correnti, per quando il motore non ha la percentuale perché la conversazione è appena stata
// compattata. Il conteggio full usa l'API di conteggio token come /context; la percentuale è intera come quella del motore, null
// se il conteggio non riesce (la barra mostra n/d, non la cifra di prima). Scartata se nel frattempo la sessione è cambiata
const estimateContext = async ($: EngineInterface, sessionId: string, basis: string) => {
  try {
    const usage = await $.session.usage({ breakdown: 'full' }).catch(() => null)
    const used = usage?.context.breakdown?.totalTokens
    if ((await $.session.id().catch(() => null)) !== sessionId) {
      return
    }
    const percent =
      usage && used !== undefined && usage.context.window
        ? Math.round(Math.min(100, (used / usage.context.window) * 100))
        : null
    await update($, contextEstimate, () => ({ percent, basis }))
    $.ui.invalidate('ui.render')
  } finally {
    if (estimating === `${sessionId}:${basis}`) {
      estimating = null
    }
  }
}

// Contesto da mostrare. Vale la percentuale del motore, che dopo un rewind è già quella del punto scelto (provato dal vivo).
// Senza percentuale, cioè subito dopo una compattazione: la stima dai messaggi, n/d a conversazione vuota (rewind all'inizio),
// altrimenti l'ultima cifra nota. Con `canEstimate` (barra ferma, stessa sessione del disegno precedente), se i messaggi sono
// cambiati dall'ultima stima ne avvia una nuova da un timer: il motore rifiuta le scritture di stato fatte mentre disegna.
// Una sessione che non ha mai avuto una cifra (nuova o ripresa) resta a n/d, senza chiamate in più
const contextFor = async (
  $: EngineInterface,
  usage: SessionUsage | null,
  measured: Snapshot | null,
  sessionId: string | null,
  canEstimate: boolean,
) => {
  if (!usage) {
    return measured?.context
  }
  if (usage.context.percent !== undefined) {
    return usage.context.percent
  }
  const estimate = await read($, contextEstimate)
  // durante un turno i messaggi crescono: l'ultima stima vale finché una risposta non porta la percentuale
  const known = estimate ? (estimate.percent ?? undefined) : measured?.context
  if (!canEstimate || sessionId === null) {
    return known
  }
  const messages = await $.session.messages().catch(() => null)
  if (!messages) {
    return known
  }
  if (messages.length === 0) {
    return undefined
  }
  const basis = messagesBasis(messages)
  if (estimate?.basis === basis) {
    return known
  }
  const key = `${sessionId}:${basis}`
  if ((measured?.context !== undefined || estimate) && estimating !== key) {
    estimating = key
    $.clock.after(0, () => {
      void estimateContext($, sessionId, basis).catch(() => undefined)
    })
  }
  return known
}

// Riempie gli atom della sessione: misura corrente, versione del mod, effort ed email dell'account.
// Serve all'avvio e quando il disegno della barra vede una sessione nuova (/clear, /resume, fork), che parte con lo stato vuoto
// senza rifare session.start. I tre passi sono indipendenti: un errore in uno non ferma gli altri
const fill = async ($: EngineInterface) => {
  try {
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
  } catch {
    // misura non disponibile: la barra usa i ripieghi finché non arriva session.measure
  }

  // Versione del mod, dal suo plugin.json (il file è del plugin, quindi leggibile)
  try {
    const manifest = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))
    lastVersion = manifest.version ?? null
    await update($, version, () => lastVersion)
  } catch {
    // manifest non leggibile: la versione resta quella già vista nel processo, se c'è
  }

  // Effort in vigore prima della prima richiesta al modello: una sessione nuova o ripresa parte da quello salvato nelle impostazioni
  // per il modello in uso (un max di sola sessione non c'è più); la prossima richiesta lo conferma o lo corregge
  try {
    const level = await readSettingsEffort($, await $.session.model())
    if (level) {
      await update($, effort, () => level)
    }
  } catch {
    // modello o impostazioni non disponibili: l'effort arriva con la prima richiesta
  }

  // Email dell'account da `claude auth status`, senza bloccare; se il comando non c'è,
  // fallisce o non la riporta vale quella del file di configurazione
  void (async () => {
    let found: string | null = null
    try {
      const { stdout } = await $.process.run(['claude', 'auth', 'status'])
      found = JSON.parse(stdout).email || null
    } catch {
      // nessun comando claude nel PATH o output non JSON: si passa al file di configurazione
    }
    found ??= await readConfigEmail($)
    if (found) {
      lastEmail = found
      await update($, email, () => found)
    }
  })().catch(() => undefined)
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

  // Dopo ogni turno, o quando un limite si muove di un punto: aggiorna la misura e ridisegna
  on('session.measure', async ($, e, next) => {
    const measured = toSnapshot(e.context, e.rateLimits)
    if (measured.fiveHour || measured.sevenDay) {
      lastLimits = { fiveHour: measured.fiveHour, sevenDay: measured.sevenDay }
    }
    // Dopo una compattazione la misura (dei soli limiti o del costo) non ha la percentuale: resta l'ultima cifra vera della
    // sessione. Una misura con la percentuale sostituisce la stima della compattazione
    await update($, snapshot, s => ({ ...measured, context: measured.context ?? s?.context }))
    if (measured.context !== undefined) {
      await update($, contextEstimate, () => null)
    }

    return next(e)
  })

  // Un prompt della persona (terminale, Remote Control o SDK), anche una skill o un comando slash che avvia un turno:
  // il prossimo turno del loop principale aprirà una nuova operazione. I comandi locali (/clear) e quelli in fork
  // non generano prompt.submit. Notifiche di task e agenti, loop e plugin non la aprono
  on('prompt.submit', async ($, e, next) => {
    if (USER_ORIGINS.includes(e.origin.kind) && !e.isMeta) {
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

  // /usage-band: alterna barra visibile e nascosta
  on('command.run', { command: 'usage-band' }, async $ => {
    const hidden = !(await read($, isHidden))
    await update($, isHidden, () => hidden)

    return { text: hidden ? 'Barra di uso nascosta.' : 'Barra di uso visibile.' }
  })

  // Un /effort scritto a mano (quello del clic sulla barra non passa dagli hook del mod, che ne rilegge l'effort da sé)
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    const result = await next(e)
    if (e.args.trim() !== '') {
      await refreshEffort($, e.args.trim())
    }

    return result
  })

  // La barra sopra il prompt
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Nascosta con /usage-band o sondaggio in corso: cede il posto (senza dati resta visibile con n/d)
    if (e.props.hasSurvey || (await read($, isHidden))) {
      return next(e)
    }

    // Una sola lettura dei dati del motore, per il costo della sessione e il contesto; null se non risponde
    const usage = await $.session.usage().catch(() => null)

    // Prima volta che si disegna una sessione (anche ripresa con /resume, che non rifà session.start): avvia il countdown.
    // Se prima se ne disegnava un'altra la sessione è cambiata (/clear, /resume, fork) e lo stato riparte vuoto: lo riempie
    // di nuovo, come session.start all'avvio. Lo fa da un timer, a disegno finito: il motore rifiuta le scritture di stato
    // fatte mentre disegna
    const sessionId = await $.session.id().catch(() => null)
    const isNewSession = sessionId !== null && sessionId !== tickedSessionId
    if (isNewSession) {
      const isSessionChange = tickedSessionId !== null
      tickedSessionId = sessionId
      void scheduleCacheTick($)
      if (isSessionChange) {
        $.clock.after(0, () => {
          void fill($).catch(() => undefined)
        })
      }
    }

    // Dopo /clear, /resume o un fork lo stato della sessione è vuoto finché fill non lo riempie: il contesto e 5h/7g sono
    // quelli che il motore conosce già, altrimenti 5h/7g, versione ed email sono gli ultimi visti nel processo
    const measured = await read($, snapshot)
    const live = usage ? toSnapshot(usage.context, usage.rateLimits) : undefined
    const data: Snapshot = {
      ...measured,
      // una stima solo a barra ferma, e non nel primo disegno di una sessione, che fill deve ancora riempire
      context: await contextFor($, usage, measured, sessionId, !e.props.isWorking && !isNewSession),
      fiveHour: measured?.fiveHour ?? live?.fiveHour ?? lastLimits.fiveHour,
      sevenDay: measured?.sevenDay ?? live?.sevenDay ?? lastLimits.sevenDay,
    }
    const folder = folderLabel(await $.session.cwd())
    // Durante un turno vale il modello della richiesta in corso (può cambiare durante il turno, ad esempio con opusplan), altrimenti quello della sessione
    const current = (e.props.isWorking ? await read($, stepModel) : null) ?? (await $.session.model())
    const model = modelLabel(current)
    const modVersion = (await read($, version)) ?? lastVersion
    const level = await read($, effort)
    const account = (await read($, email)) ?? lastEmail
    const compact = (await read($, isCompact)) || lastCompact
    const cache = await cacheState($, false).catch(() => null)
    const tokens = (await read($, operation)) ?? lastOperation
    const detailed = (await read($, isTokenDetailed)) || lastTokenDetailed
    // Costo dell'intera sessione: nullo dove il motore non lo conta, assente finché non c'è una richiesta pagata
    const sessionUsd = usage?.cost?.usd ?? null
    const sessionText = sessionUsd !== null && sessionUsd > 0 ? costLabel(sessionUsd) : null
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

    // Tempo residuo della cache del prompt: n/d prima della prima richiesta, scaduta (in rosso) a zero; assente con la cache disattivata
    const cacheSegment =
      cache === null ? null : cache.remainingMs === null ? (
        <Text dimColor>cache n/d</Text>
      ) : (
        <Text>
          <Text dimColor>cache </Text>
          <Text color={cacheColor(cache.remainingMs, cache.ttlMs)}>{cacheLabel(cache.remainingMs)}</Text>
        </Text>
      )

    // Contesto: se la percentuale è nota l'intero segmento è un pulsante che scrive nel prompt, senza inviarlo, la richiesta
    // di valutare /compact, solo se la casella è vuota (altrimenti un avviso, per non perdere ciò che si sta scrivendo);
    // con n/d resta testo semplice
    const contextPercent = data?.context
    const contextItem =
      contextPercent === undefined ? (
        segment('ctx', contextPercent)
      ) : (
        <Button
          key="context"
          label={`ctx ${Math.round(contextPercent)}%`}
          plain
          onPress={async () => {
            const { text } = await $.prompt.read()
            if (text.trim() !== '') {
              $.ui.toast('Svuota il prompt per inserire la richiesta di /compact')
              return
            }
            await $.prompt.fill({ text: compactPrompt(contextPercent) })
          }}
        >
          {segment('ctx', contextPercent)}
        </Button>
      )

    // Riga dei consumi: 5h, 7g, contesto e cache. È un Box perché il contesto è un pulsante, che non può stare dentro un Text
    const usageRow = (
      <Box>
        <Text>
          {segment('5h', data?.fiveHour?.percent, data?.fiveHour?.resetsAt)}
          <Text dimColor> │ </Text>
          {segment('7g', data?.sevenDay?.percent, data?.sevenDay?.resetsAt)}
          <Text dimColor> │ </Text>
        </Text>
        {contextItem}
        {cacheSegment ? (
          <Text>
            <Text dimColor> │ </Text>
            {cacheSegment}
          </Text>
        ) : null}
      </Box>
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

    // Costo della sessione, subito dopo i token: solo il valore, non cliccabile, in rosa (bashBorder) per distinguerlo dalle altre voci
    const sessionItem = sessionText ? <Text color="bashBorder">{sessionText}</Text> : null

    // Esegue un comando slash come se la persona lo avesse digitato, senza toccare la bozza nel prompt: /model e /effort senza
    // argomenti aprono la schermata di scelta del motore. Finito, la barra rilegge l'effort in vigore dalle impostazioni (anche il
    // modello nuovo può averne uno diverso); se il motore lo rifiuta, un avviso. Non attende il comando: il motore lo esegue solo
    // a sessione ferma, cioè dopo questo clic
    const runCommand = (command: string) => {
      void $.command.run({ command }).then(
        () => refreshEffort($, ''),
        () => $.ui.toast(`Impossibile eseguire /${command}`),
      )
    }

    // Riga dell'ambiente: token, costo della sessione, cartella (gialla), modello (arancio), effort (viola), email (azzurra) e versione
    // del mod (verde acqua); token, costo, effort, email e versione compaiono quando sono noti. Modello ed effort sono pulsanti che
    // eseguono /model e /effort, quindi stanno fuori dai Text
    const envRow = (
      <Box>
        {tokenItem}
        <Text>
          {tokens ? <Text dimColor> │ </Text> : null}
          {sessionItem}
          {sessionItem ? <Text dimColor> │ </Text> : null}
          <Text color="warning">{folder}</Text>
          <Text dimColor> │ </Text>
        </Text>
        <Button key="model" label={model} plain onPress={() => runCommand('model')}>
          <Text color="claude">{model}</Text>
        </Button>
        {level !== null ? <Text dimColor> │ </Text> : null}
        {level !== null ? (
          <Button key="effort" label={String(level)} plain onPress={() => runCommand('effort')}>
            <Text color="autoAccept">{level}</Text>
          </Button>
        ) : null}
        <Text>
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
        {usageRow}
        <Text dimColor> │ </Text>
        {toggle}
      </Box>
    )

    // Tutto su una riga se c'è posto, altrimenti due righe: una riga troppo lunga andrebbe a capo e si perderebbe la coda.
    // Compatta la riga dell'ambiente sparisce e restano consumi e pulsante (" │ [▸]")
    const envLength = compact
      ? 0
      : [tokens && `tkn ${operationText(tokens, detailed)}`, sessionText, folder, model, level !== null && String(level), account, modVersion && `v${modVersion}`]
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
            {usageRow}
            <Text dimColor> │ </Text>
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
