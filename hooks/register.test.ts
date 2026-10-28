import { expect, mock, test, type TestBody } from 'claude-code/testing'

// Proprietà della band come le passa il motore
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 10 } as never

// Input di session.start come lo passa il REPL
const START = { cwd: '', surface: 'terminal', isInteractive: true } as never

// Una misura con 5h al 75% (giallo), settimana al 31% (verde), contesto al 92% (rosso)
const MEASURE = {
  context: { window: 200000, percent: 92 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 75, resetsAt: '2026-10-13T14:30:00+02:00' },
    { kind: 'seven_day', percentUsed: 31 },
  ],
  changed: ['context', 'rateLimits'],
} as never

// Risultato di process.run come lo dà il motore: uscita, testo e nessun taglio
const ran = (stdout: string, exitCode = 0) => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

test('la barra mostra le tre percentuali con i colori per soglia', async ($, on) => {
  // Il motore sotto i plugin: nessun dato all'avvio, la misura viene dal test
  on('session.start', () => ({ cwd: '' }))
  on('session.cwd', () => ({ value: 'C:\\Users\\maurizio\\Claude\\mio-progetto' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('fs.read', () => ({ value: JSON.stringify({ name: 'usage-band', version: '9.9.9' }) }))
  on('process.run', () => ran(JSON.stringify({ loggedIn: true, email: 'maurizio@mavida.com' })))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))

  await $.session.start(START)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({
    plugin: 'usage-band',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: PROPS,
  })

  expect(await ui.find({ text: /5h .* 75%/ })).toBeDefined()
  expect(await ui.find({ text: /7g .* 31%/ })).toBeDefined()
  expect(await ui.find({ text: /ctx .* 92%/ })).toBeDefined()
  // Uno spazio tra il simbolo di reset e l'orario (preceduto dal giorno se il reset non è oggi)
  expect(await ui.find({ text: /↻ (\p{L}{3} )?\d{2}:\d{2}/u })).toBeDefined()
  // Cartella padre e cartella di lavoro, in giallo
  expect(await ui.find({ text: 'Claude\\mio-progetto' })).toBeDefined()
  // Nome leggibile del modello corrente ed email dell'account, ognuno col suo colore
  expect(await ui.find({ text: 'Opus 5.5' })).toBeDefined()
  expect(await ui.find({ text: 'maurizio@mavida.com' })).toBeDefined()
  // Versione del mod in fondo, letta dal suo plugin.json
  expect(await ui.find({ text: 'v9.9.9' })).toBeDefined()
  // Separata dalla chat da una riga vuota e da una linea tenue
  expect(await ui.find({ text: /^─+$/ })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).toContain('"marginTop":1')

  // I tre colori per soglia compaiono nell'albero disegnato
  const tree = JSON.stringify(await ui.drawn())
  expect(tree).toContain('"warning"')
  expect(tree).toContain('"success"')
  expect(tree).toContain('"error"')
  expect(tree).toContain('"claude"')
  expect(tree).toContain('"suggestion"')
  expect(tree).toContain('"planMode"')
})

test('senza alcun dato la barra resta visibile con n/d', async ($, on) => {
  on('session.start', () => ({ cwd: '' }))
  on('session.cwd', () => ({ value: 'C:\\Users\\maurizio\\Claude\\mio-progetto' }))
  on('session.model', () => ({ value: 'opus' }))
  on('fs.read', () => ({ value: JSON.stringify({ name: 'usage-band', version: '9.9.9' }) }))
  on('process.run', () => ran(JSON.stringify({ loggedIn: true, email: 'maurizio@mavida.com' })))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  await $.session.start(START)

  const ui = await $.ui.mount({
    plugin: 'usage-band',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: PROPS,
  })

  expect(await ui.find({ text: /5h n\/d/ })).toBeDefined()
  expect(await ui.find({ text: /ctx n\/d/ })).toBeDefined()
})

test('/usage-band nasconde e rimostra la barra', async ($, on) => {
  on('session.start', () => ({ cwd: '' }))
  on('session.cwd', () => ({ value: 'C:\\Users\\maurizio\\Claude\\mio-progetto' }))
  on('session.model', () => ({ value: 'opus' }))
  on('fs.read', () => ({ value: JSON.stringify({ name: 'usage-band', version: '9.9.9' }) }))
  on('process.run', () => ran(JSON.stringify({ loggedIn: true, email: 'maurizio@mavida.com' })))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  // Il motore sotto la band: se il plugin cede il posto, disegna un Text vuoto
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)

  await $.session.start(START)
  await $.session.measure(MEASURE)

  const draw = () =>
    $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  const run = () =>
    $.command.run({ command: 'usage-band', args: '', origin: { kind: 'composer' }, presentation: {} } as never)

  // Primo giro: nasconde
  expect((await run()).text).toMatch(/nascosta/)
  expect(await (await draw()).find({ text: /5h/ })).toBeUndefined()

  // Secondo giro: rimostra
  expect((await run()).text).toMatch(/visibile/)
  expect(await (await draw()).find({ text: /5h/ })).toBeDefined()
})

test('su un terminale largo tutto sta su una riga, su uno stretto vanno due righe', async ($, on) => {
  on('session.start', () => ({ cwd: '' }))
  on('session.cwd', () => ({ value: 'C:\\Users\\maurizio\\Claude\\mio-progetto' }))
  on('session.model', () => ({ value: 'opus' }))
  on('fs.read', () => ({ value: JSON.stringify({ name: 'usage-band', version: '9.9.9' }) }))
  on('process.run', () => ran(JSON.stringify({ loggedIn: true, email: 'maurizio@mavida.com' })))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))

  await $.session.start(START)

  const draw = async (columns: number) =>
    JSON.stringify(
      await (
        await $.ui.mount({
          plugin: 'usage-band',
          surface: 'terminal',
          component: 'AbovePrompt',
          props: PROPS,
          viewport: { columns, rows: 24 },
        })
      ).drawn(),
    )

  // Il Box esterno tiene separatore e barra; largo: un Box per la riga col pulsante, uno per i consumi e uno per l'ambiente,
  // stretto: un Box per le due righe, uno per i consumi col pulsante, uno per i consumi e uno per l'ambiente
  const boxes = (tree: string) => tree.split('"type":"Box"').length - 1
  expect(boxes(await draw(60))).toBe(5)
  expect(boxes(await draw(250))).toBe(4)
})

test("l'effort dell'ultima richiesta compare dopo il modello", async ($, on) => {
  on('session.start', () => ({ cwd: '' }))
  on('session.cwd', () => ({ value: 'C:\\Users\\maurizio\\Claude\\mio-progetto' }))
  on('session.model', () => ({ value: 'opus' }))
  on('fs.read', () => ({ value: JSON.stringify({ name: 'usage-band', version: '9.9.9' }) }))
  on('process.run', () => ran(JSON.stringify({ email: 'maurizio@mavida.com' })))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  // Il motore sotto turn.step: nessun chunk, risposta con turno e indice della richiesta
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as never
  })

  await $.session.start(START)

  const mount = () =>
    $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

  // Prima di una richiesta l'effort non è noto: non compare
  expect(await (await mount()).find({ text: 'high' })).toBeUndefined()

  // Una richiesta del loop principale con effort high: compare da solo, senza la parola effort, tra modello ed email
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'opus', effort: 'high', messageCount: 1 } as never)
  for await (const _chunk of stream) {
    // nessun chunk atteso
  }
  expect(await (await mount()).find({ text: 'high' })).toBeDefined()

  // Una richiesta di un subagente non cambia l'effort mostrato
  const sub = $.turn.step({ turnId: 't2', index: 0, model: 'haiku', effort: 'low', messageCount: 1, agentId: 'a1' } as never)
  for await (const _chunk of sub) {
    // nessun chunk atteso
  }
  expect(await (await mount()).find({ text: 'high' })).toBeDefined()
})

test('dopo /clear la barra ritrova consumi, email e versione', async ($, on) => {
  // La sessione corrente e la lettura dei limiti del motore cambiano col /clear; auth status conta le chiamate
  let sessionId = 's1'
  let rateLimits: unknown[] = []
  let authCalls = 0
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '' }))
  on('session.id', () => ({ value: sessionId }))
  on('session.cwd', () => ({ value: 'C:\\Users\\maurizio\\Claude\\mio-progetto' }))
  on('session.model', () => ({ value: 'opus' }))
  on('fs.read', () => ({ value: JSON.stringify({ name: 'usage-band', version: '9.9.9' }) }))
  on('process.run', () => {
    authCalls++
    return ran(JSON.stringify({ loggedIn: true, email: 'maurizio@mavida.com' }))
  })
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits } }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))

  await $.session.start(START)
  await $.session.measure(MEASURE)
  const mount = () =>
    $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  await mount()
  expect(authCalls).toBe(1)

  // Il /clear: una sessione nuova, senza session.start né SessionStart (scavalcato da un plugin gestito), con limiti nuovi nel motore.
  // Il primo disegno della sessione nuova la riempie di nuovo, a disegno finito: misura, versione ed email (auth status richiamato)
  sessionId = 's2'
  rateLimits = [
    { kind: 'five_hour', percentUsed: 12 },
    { kind: 'seven_day', percentUsed: 40 },
  ]
  await mount()
  await clock.settle()
  expect(authCalls).toBe(2)
  const ui = await mount()
  expect(await ui.find({ text: /5h .* 12%/ })).toBeDefined()
  expect(await ui.find({ text: /7g .* 40%/ })).toBeDefined()
  expect(await ui.find({ text: 'maurizio@mavida.com' })).toBeDefined()
  expect(await ui.find({ text: 'v9.9.9' })).toBeDefined()

  // Un disegno successivo della stessa sessione non la riempie di nuovo
  await mount()
  expect(authCalls).toBe(2)

  // Una misura senza limiti: la barra mostra quelli che il motore conosce ora, non gli ultimi visti nel processo
  rateLimits = [
    { kind: 'five_hour', percentUsed: 20 },
    { kind: 'seven_day', percentUsed: 50 },
  ]
  await $.session.measure({ context: { window: 200000, percent: 10 }, rateLimits: [], changed: ['context'] } as never)
  expect(await (await mount()).find({ text: /5h .* 20%/ })).toBeDefined()
})

test("senza claude auth status l'email viene dal file di configurazione", async ($, on) => {
  mock.env(on, { CLAUDE_CONFIG_DIR: 'C:\\cfg' })
  // Il percorso come lo raggiunge il motore, con i separatori di Windows
  const config = 'C:\\cfg\\.claude.json'
  on('session.start', () => ({ cwd: '' }))
  on('session.cwd', () => ({ value: 'C:\\Users\\maurizio\\Claude\\mio-progetto' }))
  on('session.model', () => ({ value: 'opus' }))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  // claude non è nel PATH
  on('process.run', () => ({ deny: 'ENOENT' }) as never)
  on('fs.stat', (_$, e) => (e.path === config ? { value: { kind: 'file', size: 1000, mtimeMs: 0, isLink: false } } : { deny: 'ENOENT' }) as never)
  on('fs.read', (_$, e) =>
    ({
      value: JSON.stringify(e.path === config ? { oauthAccount: { emailAddress: 'maurizio@mavida.com' } } : { name: 'usage-band', version: '9.9.9' }),
    }) as never,
  )

  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: 'maurizio@mavida.com' })).toBeDefined()
})

test("se la misura non risponde all'avvio, versione ed email compaiono lo stesso", async ($, on) => {
  on('session.start', () => ({ cwd: '' }))
  on('session.cwd', () => ({ value: 'C:\\Users\\maurizio\\Claude\\mio-progetto' }))
  on('session.model', () => ({ value: 'opus' }))
  on('fs.read', () => ({ value: JSON.stringify({ name: 'usage-band', version: '9.9.9' }) }))
  on('process.run', () => ran(JSON.stringify({ email: 'maurizio@mavida.com' })))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.usage', () => ({ deny: 'non disponibile' }) as never)

  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: 'v9.9.9' })).toBeDefined()
  expect(await ui.find({ text: 'maurizio@mavida.com' })).toBeDefined()
})

test('il nome del modello è leggibile anche per ID datati, vecchio schema e contesto esteso', async ($, on) => {
  let model = ''
  on('session.start', () => ({ cwd: '' }))
  on('session.cwd', () => ({ value: 'C:\\Users\\maurizio\\Claude\\mio-progetto' }))
  on('session.model', () => ({ value: model }))
  on('fs.read', () => ({ value: JSON.stringify({ name: 'usage-band', version: '9.9.9' }) }))
  on('process.run', () => ran('', 1))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  await $.session.start(START)

  const cases: [string, string][] = [
    ['claude-sonnet-5-5-20260301', 'Sonnet 5.5'],
    ['claude-3-5-sonnet-20241022', 'Sonnet 3.5'],
    ['claude-opus-5-5[1m]', 'Opus 5.5 (1M)'],
    ['haiku', 'Haiku'],
    ['modello-sconosciuto.v2', 'modello-sconosciuto.v2'],
  ]
  for (const [id, label] of cases) {
    model = id
    const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ text: label })).toBeDefined()
  }
})

test('il pulsante nasconde e rimostra cartella, modello, effort, email e versione', async ($, on) => {
  on('session.start', () => ({ cwd: '' }))
  on('session.cwd', () => ({ value: 'C:\\Users\\maurizio\\Claude\\mio-progetto' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('fs.read', () => ({ value: JSON.stringify({ name: 'usage-band', version: '9.9.9' }) }))
  on('process.run', () => ran(JSON.stringify({ email: 'maurizio@mavida.com' })))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as never
  })

  await $.session.start(START)
  await $.session.measure(MEASURE)
  for await (const _chunk of $.turn.step({ turnId: 't1', index: 0, model: 'opus', effort: 'medium', messageCount: 1 } as never)) {
    // nessun chunk atteso
  }

  const mount = () =>
    $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

  // Visibili all'inizio
  const ui = await mount()
  expect(await ui.find({ text: 'Opus 5.5' })).toBeDefined()

  // Premuto: restano i consumi, spariscono i dettagli
  await ui.press({ key: 'details' })
  const compact = await mount()
  expect(await compact.find({ text: /5h .* 75%/ })).toBeDefined()
  for (const text of ['Opus 5.5', 'medium', 'maurizio@mavida.com', 'v9.9.9', 'Claude\mio-progetto']) {
    expect(await compact.find({ text })).toBeUndefined()
  }

  // Premuto di nuovo: tornano
  await compact.press({ key: 'details' })
  expect(await (await mount()).find({ text: 'Opus 5.5' })).toBeDefined()
})

// Il motore sotto la band per i test della cache e dei token: dati minimi e turn.step che risponde senza chunk,
// con i token che `usages` assegna alla richiesta (turno/indice), se ci sono, e il costo della sessione in `cost.usd`, se c'è
const stubEngine = (
  on: Parameters<TestBody>[1],
  usages: Record<string, unknown> = {},
  cost: { usd?: number } = {},
) => {
  on('session.start', () => ({ cwd: '' }))
  on('session.cwd', () => ({ value: 'C:\\Users\\maurizio\\Claude\\mio-progetto' }))
  on('session.model', () => ({ value: 'opus' }))
  on('fs.read', () => ({ value: JSON.stringify({ name: 'usage-band', version: '9.9.9' }) }))
  on('process.run', () => ran('', 1))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: [], ...(cost.usd === undefined ? {} : { cost: { usd: cost.usd } }) },
  }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], usage: usages[`${e.turnId}/${e.index}`] ?? null } as never
  })
}

// Gli ultimi 10 minuti simulati scattano di secondo in secondo: serve più del tempo standard di un test
test('la cache mostra i minuti sopra i 10 minuti, poi minuti e secondi, poi scaduta', { timeoutMs: 30000 }, async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, {})
  stubEngine(on)
  await $.session.start(START)

  // Un solo disegno montato: è il timer della cache a ridisegnarlo (montarne uno a ogni controllo
  // moltiplicherebbe i ridisegni di ogni secondo simulato)
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  const step = async (agentId?: string) => {
    for await (const _chunk of $.turn.step({ turnId: 't', index: 0, model: 'opus', messageCount: 1, agentId } as never)) {
      // nessun chunk atteso
    }
  }

  // Prima della prima richiesta la scadenza non è nota
  expect(await ui.find({ text: /cache n\/d/ })).toBeDefined()

  // Subito dopo una richiesta: un'ora piena, in minuti e in verde
  await step()
  expect(await ui.find({ text: /cache 60m/ })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).toContain('"success"')

  // A 10 minuti esatti passa a minuti e secondi, poi scende di secondo in secondo, in rosso sotto i 6 minuti
  await clock.advance(50 * 60_000)
  expect(await ui.find({ text: /cache 10:00/ })).toBeDefined()
  await clock.advance(1000)
  expect(await ui.find({ text: /cache 9:59/ })).toBeDefined()

  // La richiesta di un subagente non rinnova la cache del thread principale
  await step('a1')
  expect(await ui.find({ text: /cache 9:59/ })).toBeDefined()

  // Allo scadere
  await clock.advance(10 * 60_000)
  expect(await ui.find({ text: /cache scaduta/ })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).toContain('"error"')
})

test('la durata della cache viene dalle variabili di ambiente', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { ENABLE_PROMPT_CACHING_1H: '1', FORCE_PROMPT_CACHING_5M: '1' })
  stubEngine(on)
  await $.session.start(START)

  for await (const _chunk of $.turn.step({ turnId: 't', index: 0, model: 'opus', messageCount: 1 } as never)) {
    // nessun chunk atteso
  }

  // FORCE_PROMPT_CACHING_5M vince: cinque minuti, già sotto la soglia dei secondi
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: /cache 5:00/ })).toBeDefined()
})

test("senza variabili di ambiente la cache dura un'ora", async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, {})
  stubEngine(on)
  await $.session.start(START)

  for await (const _chunk of $.turn.step({ turnId: 't', index: 0, model: 'opus', messageCount: 1 } as never)) {
    // nessun chunk atteso
  }

  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: /cache 60m/ })).toBeDefined()
})

test('con la cache disattivata la voce non compare', async ($, on) => {
  mock.clock(on)
  mock.env(on, { DISABLE_PROMPT_CACHING: '1' })
  stubEngine(on)
  await $.session.start(START)

  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: /ctx/ })).toBeDefined()
  expect(await ui.find({ text: /cache/ })).toBeUndefined()
})

// Una riga del transcript: risposta del modello all'istante dato, del thread principale o di un subagente
const responseRow = (at: number, isSidechain = false) =>
  JSON.stringify({ type: 'assistant', isSidechain, timestamp: new Date(at).toISOString(), message: { model: 'claude-opus-5-5' } })

test('dopo /resume la cache riparte dall\'ultima risposta del transcript', async ($, on) => {
  const NOW = Date.parse('2026-10-21T10:00:00Z')
  mock.clock(on, { now: NOW })
  mock.env(on, { CLAUDE_CONFIG_DIR: 'C:\\cfg' })
  // Il transcript come lo raggiunge il motore, con i separatori di Windows
  const transcript = 'C:\\cfg\\projects\\C--Users-maurizio-Claude-mio-progetto\\s1.jsonl'
  const rows = [
    // l'ultima risposta del thread principale, 10 minuti fa
    responseRow(NOW - 10 * 60_000),
    // dopo: un subagente, una risposta sintetica e una riga di sistema, che non contano
    responseRow(NOW - 60_000, true),
    JSON.stringify({ type: 'assistant', timestamp: new Date(NOW - 30_000).toISOString(), message: { model: '<synthetic>' } }),
    JSON.stringify({ type: 'system', timestamp: new Date(NOW).toISOString() }),
  ]
  on('session.start', () => ({ cwd: '' }))
  on('session.cwd', () => ({ value: 'C:\\Users\\maurizio\\Claude\\mio-progetto' }))
  on('session.root', () => ({ value: 'C:\\Users\\maurizio\\Claude\\mio-progetto' }))
  on('session.model', () => ({ value: 'opus' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('process.run', () => ran('', 1))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', (_$, e) => (e.path === transcript ? { value: { kind: 'file', size: 1000, mtimeMs: NOW, isLink: false } } : { deny: 'ENOENT' }) as never)
  on('fs.read', (_$, e) =>
    ({ value: e.path === transcript ? rows.join('\n') + '\n' : JSON.stringify({ name: 'usage-band', version: '9.9.9' }) }) as never,
  )
  await $.session.start(START)

  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: /cache 50m/ })).toBeDefined()
})

test('senza SessionStart il contesto viene comunque dal motore', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, {})
  on('session.cwd', () => ({ value: 'C:\\Users\\maurizio\\Claude\\mio-progetto' }))
  on('session.model', () => ({ value: 'opus' }))
  // Il motore conosce già il contesto, ma lo stato del mod è vuoto: nessuna misura né SessionStart lo ha raggiunto
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 42 }, rateLimits: [] } }))

  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ text: /ctx .* 42%/ })).toBeDefined()
})

// Un prompt scritto dalla persona: prompt.submit dal terminale, poi il turno che lo esegue
const prompt = async ($: Parameters<TestBody>[0], text: string, turnId: string) => {
  await $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false } as never)
  await $.turn.start({ text, turnId } as never)
}

// Una richiesta al modello con i suoi token, del loop principale o di un subagente
const usage = (input: number, output: number, cacheRead: number, cacheWrite = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
  model: 'opus',
})

test("i token dell'ultima operazione sommano richieste e subagenti, col dettaglio al clic", async ($, on) => {
  // Ogni richiesta risponde con i token che il test le assegna, in base al suo turno
  const usages: Record<string, ReturnType<typeof usage>> = {}
  // Costo della sessione: $1.00 quando parte il prompt, poi cresce con le risposte
  const cost: { usd?: number } = { usd: 1 }
  stubEngine(on, usages, cost)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'a1' }))
  await $.session.start(START)

  const mount = () =>
    $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS, viewport: { columns: 400, rows: 24 } })
  const step = async (turnId: string, index: number, agentId?: string) => {
    for await (const _chunk of $.turn.step({ turnId, index, model: 'opus', messageCount: 1, agentId } as never)) {
      // nessun chunk atteso
    }
  }

  // Prima di un prompt la voce dei token non c'è, quella del costo della sessione sì (la sessione ha già $1.00)
  expect(await (await mount()).find({ text: /tkn/ })).toBeUndefined()
  expect(await (await mount()).find({ text: /^\$1\.00$/ })).toBeDefined()

  // Un prompt: due richieste del loop principale e un subagente con la sua richiesta
  await prompt($, 'fai qualcosa', 't1')
  usages['t1/0'] = usage(500, 300, 10_000, 200)
  usages['t1/1'] = usage(42, 0, 0)
  usages['s1/0'] = usage(1000, 400, 1_000_000)
  cost.usd = 1.1
  await step('t1', 0)
  await $.agent.spawn({ prompt: 'cerca', description: 'cerca', subagentType: 'Explore', parentModel: 'opus', background: false, fork: false } as never)
  cost.usd = 1.2
  await step('s1', 0, 'a1')
  cost.usd = 1.25
  await step('t1', 1)

  // Totale compatto: solo i token nuovi, 500+300+200 + 42 + 1000+400 = 2442 → 2.4k, e il costo cresciuto di $0.25
  const ui = await mount()
  expect(await ui.find({ text: /tkn 2\.4k · \$0\.25/ })).toBeDefined()
  // Il costo dell'intera sessione sta a destra dei token, senza etichetta e non cliccabile
  expect(await ui.find({ text: /^\$1\.25$/ })).toBeDefined()

  // Clic sulla scritta: ingresso 500+200+42+1000, uscita 300+400, letti 1010000 (il 100% dell'ingresso, arrotondato), agenti 1001400
  await ui.press({ key: 'tokens' })
  expect(await (await mount()).find({ text: /↑1\.7k ↓700 ♺ 1\.01M 100% \(∴1\.00M\) · \$0\.25/ })).toBeDefined()

  // La notifica di un agente in background arriva con testo ma non è un prompt della persona: continua l'operazione
  await $.prompt.submit({ text: 'resoconto agente', origin: { kind: 'task-notification' }, wait: false } as never)
  await $.turn.start({ text: 'resoconto agente', turnId: 't2' } as never)
  usages['t2/0'] = usage(8, 0, 0)
  await step('t2', 0)
  expect(await (await mount()).find({ text: /↑1\.8k/ })).toBeDefined()

  // Un nuovo prompt riparte da zero e il subagente dell'operazione precedente non lo tocca
  await prompt($, 'altro', 't3')
  usages['t3/0'] = usage(842, 0, 0)
  usages['s1/1'] = usage(5000, 0, 0)
  cost.usd = 1.255
  await step('t3', 0)
  await step('s1', 1, 'a1')
  const next = await mount()
  // Nessuna lettura dalla cache (riuso 0%) e un costo sotto il centesimo
  expect(await next.find({ text: /↑842 ↓0 ♺ 0 0% \(∴0\) · <\$0\.01/ })).toBeDefined()

  // Il pulsante dei dettagli nasconde anche i token
  await next.press({ key: 'details' })
  expect(await (await mount()).find({ text: /tkn/ })).toBeUndefined()
})

test('senza costo della sessione, o a zero, la voce del costo non compare', async ($, on) => {
  const cost: { usd?: number } = {}
  stubEngine(on, {}, cost)
  await $.session.start(START)

  const mount = () =>
    $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS, viewport: { columns: 400, rows: 24 } })

  // Il motore non tiene il conto: nessuna voce
  expect(await (await mount()).find({ text: /\$/ })).toBeUndefined()

  // Un conto a zero (nessuna richiesta pagata) non mostra "<$0.01"
  cost.usd = 0
  expect(await (await mount()).find({ text: /\$/ })).toBeUndefined()

  // Dalla prima spesa la voce compare
  cost.usd = 0.5
  expect(await (await mount()).find({ text: /^\$0\.50$/ })).toBeDefined()
})

test("un subagente di cui il mod non ha visto lo spawn conta comunque per l'operazione in corso", async ($, on) => {
  const usages: Record<string, ReturnType<typeof usage>> = {}
  stubEngine(on, usages)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  await $.session.start(START)

  const step = async (turnId: string, index: number, agentId?: string) => {
    for await (const _chunk of $.turn.step({ turnId, index, model: 'opus', messageCount: 1, agentId } as never)) {
      // nessun chunk atteso
    }
  }

  await prompt($, 'fai qualcosa', 't1')
  usages['t1/0'] = usage(100, 10, 0)
  usages['s1/0'] = usage(200, 20, 0)
  usages['s2/0'] = usage(300, 30, 0)
  await step('t1', 0)
  // Un subagente che apre il suo turno senza spawn ascoltato, e uno mai visto prima della sua richiesta
  await $.turn.start({ text: 'cerca', turnId: 's1', agentId: 'b1' } as never)
  await step('s1', 0, 'b1')
  await step('s2', 0, 'b2')

  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS, viewport: { columns: 400, rows: 24 } })
  await ui.press({ key: 'tokens' })
  expect(await (await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS, viewport: { columns: 400, rows: 24 } })).find({ text: /↑600 ↓60 ♺ 0 0% \(∴550\)$/ })).toBeDefined()
})

test('durante un turno il modello è quello della richiesta in corso, a turno finito torna quello della sessione', async ($, on) => {
  mock.clock(on)
  mock.env(on, {})
  stubEngine(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  await $.session.start(START)

  const mount = (isWorking: boolean) =>
    $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: { ...(PROPS as object), isWorking } as never })

  // Con opusplan in plan mode il motore risolve la richiesta su un altro modello rispetto a quello della sessione (opus)
  await $.turn.start({ text: 'piano', turnId: 't1' } as never)
  for await (const _chunk of $.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1 } as never)) {
    // nessun chunk atteso
  }
  expect(await (await mount(true)).find({ text: /Sonnet 5\.5/ })).toBeDefined()

  // A turno finito vale di nuovo il modello della sessione
  expect(await (await mount(false)).find({ text: /Sonnet 5\.5/ })).toBeUndefined()

  // Un turno nuovo, prima della sua prima richiesta, non mostra il modello del turno precedente
  await $.turn.start({ text: 'altro', turnId: 't2' } as never)
  expect(await (await mount(true)).find({ text: /Sonnet 5\.5/ })).toBeUndefined()
})

test('il clic sul contesto scrive nel prompt vuoto la richiesta di valutare /compact, senza inviarla', async ($, on) => {
  on('session.start', () => ({ cwd: '' }))
  on('session.cwd', () => ({ value: 'C:\\Users\\maurizio\\Claude\\mio-progetto' }))
  on('session.model', () => ({ value: 'opus' }))
  on('fs.read', () => ({ value: JSON.stringify({ name: 'usage-band', version: '9.9.9' }) }))
  on('process.run', () => ran('', 1))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  // La casella del prompt del motore: la bozza che contiene, cosa le viene scritto, se qualcuno invia, gli avvisi mostrati
  let draft = 'sto scrivendo'
  const fills: { text: string; mode: string }[] = []
  const toasts: string[] = []
  let submitted = false
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  on('prompt.fill', (_$, e) => {
    fills.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  on('prompt.submit', (_$, e) => {
    submitted = true
    return { text: e.text }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  await $.session.start(START)
  await $.session.measure(MEASURE)
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  // Il segmento resta uguale a prima: etichetta, barra e percentuale
  expect(await ui.find({ text: /ctx .* 92%/ })).toBeDefined()

  // Con una bozza nella casella non scrive nulla e avvisa
  await ui.press({ key: 'context' })
  expect(fills).toEqual([])
  expect(toasts).toHaveLength(1)

  // Con la casella vuota (o solo spazi) scrive la richiesta
  draft = '  '
  await ui.press({ key: 'context' })
  expect(fills).toEqual([
    {
      text:
        'Il tuo contesto è al 92%, valuta se è necessario eseguire il comando /compact. ' +
        'Se sì scrivimi il comando con le indicazioni su cosa mantenere e cosa pulire e, se serve, ' +
        'scrivi nella memoria e/o nello scratchpad ciò che ti serve per proseguire',
      mode: 'replace',
    },
  ])
  expect(submitted).toBe(false)
})

test("il clic sul modello esegue /model e quello sull'effort esegue /effort, poi la barra rilegge l'effort", async ($, on) => {
  on('session.start', () => ({ cwd: '' }))
  on('session.cwd', () => ({ value: 'C:\\Users\\maurizio\\Claude\\mio-progetto' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  // Le impostazioni dell'utente, dove /model e /effort salvano il livello del modello in uso (il percorso con i separatori di Windows)
  mock.env(on, { CLAUDE_CONFIG_DIR: 'C:\\cfg' })
  const settingsPath = 'C:\\cfg\\settings.json'
  const settings = { effortLevel: 'medium', modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' } } }
  on('fs.stat', (_$, e) => (e.path === settingsPath ? { value: { kind: 'file', size: 1000, mtimeMs: 0, isLink: false } } : { deny: 'ENOENT' }) as never)
  on('fs.read', (_$, e) =>
    ({ value: JSON.stringify(e.path === settingsPath ? settings : { name: 'usage-band', version: '9.9.9' }) }) as never,
  )
  on('process.run', () => ran('', 1))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as never
  })
  // Il motore sotto command.run: registra i comandi eseguiti (la scelta nella schermata salva l'effort), o li rifiuta; gli avvisi mostrati
  const commands: string[] = []
  let isRefused = false
  const toasts: string[] = []
  const clock = mock.clock(on)
  on('command.run', (_$, e) => {
    if (isRefused) {
      throw new Error('rifiutato')
    }
    commands.push(`${e.command} ${e.args}`.trim())
    if (e.command === 'effort') {
      settings.modelSettings['claude-opus-5-5'].effortLevel = 'xhigh'
    }
    return {}
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  await $.session.start(START)
  for await (const _chunk of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 } as never)) {
    // nessun chunk atteso
  }
  const band = async () => $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  const ui = await band()
  // Le voci restano uguali a prima: nome del modello ed effort
  expect(await ui.find({ text: /Opus 5\.5/ })).toBeDefined()
  expect(await ui.find({ text: 'high' })).toBeDefined()

  // I clic eseguono i comandi senza argomenti, che aprono la schermata di scelta del motore
  await ui.press({ key: 'model' })
  await clock.settle()
  expect(commands).toEqual(['model'])
  await ui.press({ key: 'effort' })
  await clock.settle()
  expect(commands).toEqual(['model', 'effort'])
  // Finito /effort la barra mostra il livello salvato nelle impostazioni
  expect(await (await band()).find({ text: 'xhigh' })).toBeDefined()
  expect(toasts).toEqual([])

  // Se il motore rifiuta il comando, un avviso
  isRefused = true
  await ui.press({ key: 'model' })
  await clock.settle()
  expect(commands).toEqual(['model', 'effort'])
  expect(toasts).toEqual(['Impossibile eseguire /model'])
})

test("in una sessione nuova o ripresa l'effort viene dalle impostazioni prima del primo prompt", async ($, on) => {
  const clock = mock.clock(on)
  let sessionId = 's1'
  on('session.start', () => ({ cwd: '' }))
  on('session.id', () => ({ value: sessionId }))
  on('session.cwd', () => ({ value: 'C:\\Users\\maurizio\\Claude\\mio-progetto' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  // Le impostazioni dell'utente: effort generale e quello salvato per il modello in uso
  mock.env(on, { CLAUDE_CONFIG_DIR: 'C:\\cfg' })
  const settingsPath = 'C:\\cfg\\settings.json'
  const settings = { effortLevel: 'medium', modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } } }
  on('fs.stat', (_$, e) => (e.path === settingsPath ? { value: { kind: 'file', size: 1000, mtimeMs: 0, isLink: false } } : { deny: 'ENOENT' }) as never)
  on('fs.read', (_$, e) =>
    ({ value: JSON.stringify(e.path === settingsPath ? settings : { name: 'usage-band', version: '9.9.9' }) }) as never,
  )
  on('process.run', () => ran('', 1))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  const mount = () => $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

  // All'avvio, senza alcuna richiesta al modello: l'effort salvato per il modello
  await $.session.start(START)
  expect(await (await mount()).find({ text: 'xhigh' })).toBeDefined()

  // Dopo /clear o /resume (sessione nuova) torna dalle impostazioni, ora cambiate
  settings.modelSettings['claude-opus-5-5'].effortLevel = 'low'
  sessionId = 's2'
  await mount()
  await clock.settle()
  expect(await (await mount()).find({ text: 'low' })).toBeDefined()
})

// Il motore per i test del contesto: percentuale dell'ultima risposta (assente subito dopo una compattazione), messaggi correnti
// (con le letture contate) e conteggio per categorie, che conta le chiamate, può fallire e può rispondere quando la sessione è
// già cambiata; la lettura semplice dei dati può non rispondere
const stubContext = (on: Parameters<TestBody>[1]) => {
  const engine = {
    sessionId: 's1',
    percent: 92 as number | undefined,
    used: 184000,
    messages: [] as unknown[],
    messageReads: 0,
    counts: 0,
    isCountFailing: false,
    isUsageFailing: false,
    sessionAfterCount: null as string | null,
    // eseguito una volta alla prossima lettura semplice dei dati, prima che risponda
    beforeUsage: null as (() => Promise<unknown>) | null,
  }
  on('session.start', () => ({ cwd: '' }))
  on('session.id', () => ({ value: engine.sessionId }))
  on('session.cwd', () => ({ value: 'C:\\Users\\maurizio\\Claude\\mio-progetto' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('fs.read', () => ({ value: JSON.stringify({ name: 'usage-band', version: '9.9.9' }) }))
  on('process.run', () => ran(JSON.stringify({ loggedIn: true, email: 'maurizio@mavida.com' })))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.messages', () => {
    engine.messageReads++
    return { value: engine.messages } as never
  })
  on('session.usage', async (_$, e) => {
    // la lettura risponde con la percentuale di quando è partita, anche se nel frattempo è cambiata
    const percent = engine.percent
    if (e.breakdown) {
      engine.counts++
      engine.sessionId = engine.sessionAfterCount ?? engine.sessionId
      if (engine.isCountFailing) {
        throw new Error('conteggio non disponibile')
      }
    } else if (engine.isUsageFailing) {
      throw new Error('dati non disponibili')
    } else if (engine.beforeUsage) {
      const run = engine.beforeUsage
      engine.beforeUsage = null
      await run()
    }
    const breakdown = e.breakdown ? { breakdown: { totalTokens: engine.used } } : {}
    return { value: { startedAt: 0, context: { window: 200000, percent, ...breakdown }, rateLimits: [] } } as never
  })
  return engine
}

// Un messaggio come lo dà $.session.messages()
const message = (role: 'user' | 'assistant', text: string) => ({ role, text, toolUses: [] })

// Proprietà della band durante un turno
const WORKING = { hasSurvey: false, isWorking: true, maxRows: 10 } as never

test('dopo una compattazione ctx stima il contesto dai messaggi, anche dopo una seconda di fila, finché una risposta non porta la percentuale', async ($, on) => {
  const engine = stubContext(on)
  const clock = mock.clock(on)
  const mount = (props = PROPS) => $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props })
  engine.messages = [message('user', 'Prima domanda'), message('assistant', 'Prima risposta')]

  await $.session.start(START)
  await $.session.measure(MEASURE)
  expect(await (await mount()).find({ text: /ctx .* 92%/ })).toBeDefined()

  // /compact: il motore non ha più la percentuale e i messaggi sono il riassunto. La barra si ridisegna da sé e stima da un timer
  engine.percent = undefined
  engine.messages = [message('user', 'Riassunto'), message('user', 'Compattato')]
  engine.used = 30000
  await mount()
  await clock.settle()
  expect(await (await mount()).find({ text: /ctx .* 15%/ })).toBeDefined()
  // Altri disegni della stessa conversazione non contano di nuovo
  await mount()
  await clock.settle()
  expect(engine.counts).toBe(1)

  // Un disegno in cui il motore non risponde mostra la stima, non la cifra di prima della compattazione
  engine.isUsageFailing = true
  expect(await (await mount()).find({ text: /ctx .* 15%/ })).toBeDefined()
  engine.isUsageFailing = false

  // Una misura dei soli limiti, senza percentuale, lascia la stima
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], changed: ['rateLimits'] } as never)
  expect(await (await mount()).find({ text: /ctx .* 15%/ })).toBeDefined()

  // Un'altra /compact subito dopo, con lo stesso ultimo messaggio: una stima nuova, intera come l'etichetta e del colore della
  // sua soglia (l'89,6% è 90%, rosso)
  engine.messages = [message('user', 'Riassunto più ricco'), message('user', 'Compattato')]
  engine.used = 179200
  await mount()
  await clock.settle()
  const ui = await mount()
  expect(await ui.find({ text: /ctx .* 90%/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^\S+ 90%$/ }))?.props.color).toBe('error')
  expect(engine.counts).toBe(2)

  // Durante il turno successivo la stima resta, senza altri conteggi
  engine.messages = [...engine.messages, message('user', 'Nuova domanda')]
  expect(await (await mount(WORKING)).find({ text: /ctx .* 90%/ })).toBeDefined()
  await clock.settle()
  expect(engine.counts).toBe(2)

  // La risposta porta la percentuale vera, che sostituisce la stima
  engine.percent = 12
  await $.session.measure({ context: { window: 200000, percent: 12 }, rateLimits: [], changed: ['context'] } as never)
  expect(await (await mount()).find({ text: /ctx .* 12%/ })).toBeDefined()
})

test('dopo un rewind ctx mostra il contesto del punto scelto, e n/d tornando a una conversazione vuota', async ($, on) => {
  const engine = stubContext(on)
  const clock = mock.clock(on)
  const mount = (props = PROPS) => $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props })
  engine.messages = [
    message('user', 'Prima domanda'),
    message('assistant', 'Prima risposta'),
    message('user', 'Seconda domanda'),
    message('assistant', 'Seconda risposta'),
  ]
  engine.percent = 40

  await $.session.start(START)
  await $.session.measure({ context: { window: 200000, percent: 40 }, rateLimits: [], changed: ['context'] } as never)
  expect(await (await mount()).find({ text: /ctx .* 40%/ })).toBeDefined()

  // Il rewind (con /rewind o doppio Esc) non porta misure: il motore ha già la percentuale del punto scelto
  engine.percent = 39
  engine.messages = engine.messages.slice(0, 2)
  expect(await (await mount()).find({ text: /ctx .* 39%/ })).toBeDefined()

  // Fino all'inizio: né percentuale né messaggi, come in una sessione nuova
  engine.percent = undefined
  engine.messages = []
  expect(await (await mount()).find({ text: /ctx n\/d/ })).toBeDefined()

  // Il prompt che segue: durante il turno resta n/d, non il 40% di prima del rewind. Senza attendere i timer: dal vivo una
  // scrittura di stato partita dal disegno non arriva
  // Durante il turno n/d è già deciso: i messaggi non si rileggono
  engine.messages = [message('user', 'Nuova domanda')]
  const readsBefore = engine.messageReads
  expect(await (await mount(WORKING)).find({ text: /ctx n\/d/ })).toBeDefined()
  expect(engine.messageReads).toBe(readsBefore)
  await clock.settle()
  expect(engine.counts).toBe(0)

  // Un turno interrotto prima della risposta: a barra ferma la stima della conversazione nuova prende il posto di n/d
  engine.used = 10000
  await mount()
  await clock.settle()
  expect(await (await mount()).find({ text: /ctx .* 5%/ })).toBeDefined()

  // La risposta al prompt successivo porta la percentuale
  engine.percent = 3
  await $.session.measure({ context: { window: 200000, percent: 3 }, rateLimits: [], changed: ['context'] } as never)
  expect(await (await mount()).find({ text: /ctx .* 3%/ })).toBeDefined()
})

test('se il conteggio dei token non riesce, dopo una compattazione ctx mostra n/d invece della cifra di prima', async ($, on) => {
  const engine = stubContext(on)
  const clock = mock.clock(on)
  const mount = () => $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  engine.messages = [message('user', 'Domanda'), message('assistant', 'Risposta')]
  engine.isCountFailing = true

  await $.session.start(START)
  await $.session.measure(MEASURE)
  expect(await (await mount()).find({ text: /ctx .* 92%/ })).toBeDefined()

  engine.percent = undefined
  engine.messages = [message('user', 'Riassunto')]
  await mount()
  await clock.settle()
  expect(await (await mount()).find({ text: /ctx n\/d/ })).toBeDefined()
  // Nessun nuovo tentativo sulla stessa conversazione
  await clock.settle()
  expect(engine.counts).toBe(1)
})

test('una stima finita dopo /clear o /resume non passa alla sessione nuova', async ($, on) => {
  const engine = stubContext(on)
  const clock = mock.clock(on)
  const mount = () => $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  engine.messages = [message('user', 'Domanda'), message('assistant', 'Risposta')]

  await $.session.start(START)
  await $.session.measure(MEASURE)
  await mount()

  // /compact, e il conteggio risponde quando la sessione è già un'altra
  engine.percent = undefined
  engine.messages = [message('user', 'Riassunto')]
  engine.used = 30000
  engine.sessionAfterCount = 's2'
  await mount()
  await clock.settle()
  expect(engine.counts).toBe(1)

  // La sessione nuova, riempita da fill, non ha cifre: n/d, senza la stima della vecchia e senza contarne una sua
  await mount()
  await clock.settle()
  expect(await (await mount()).find({ text: /ctx n\/d/ })).toBeDefined()
  await clock.settle()
  expect(engine.counts).toBe(1)
})

test('in una sessione che non ha ancora cifre ctx resta n/d senza contare i token', async ($, on) => {
  const engine = stubContext(on)
  const clock = mock.clock(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  const mount = () => $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  engine.percent = undefined
  engine.messages = [message('user', 'Prima domanda')]

  await $.session.start(START)
  // Il primo turno non cerca una conversazione svuotata: senza cifre non c'è nulla da nascondere
  await $.turn.start({ text: 'Prima domanda', turnId: 't1' } as never)
  await mount()
  await mount()
  await clock.settle()
  expect(await (await mount()).find({ text: /ctx n\/d/ })).toBeDefined()
  expect(engine.counts).toBe(0)
  // Nemmeno i messaggi vengono letti
  expect(engine.messageReads).toBe(0)
})

test('una stima finita dopo la risposta che porta la percentuale non torna alla compattazione successiva', async ($, on) => {
  const engine = stubContext(on)
  const clock = mock.clock(on)
  const mount = () => $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  engine.messages = [message('user', 'Domanda'), message('assistant', 'Risposta')]

  await $.session.start(START)
  await $.session.measure(MEASURE)
  await mount()

  // /compact: la stima parte da un timer, ma prima che il conteggio finisca arriva una risposta con la percentuale vera
  engine.percent = undefined
  engine.messages = [message('user', 'Riassunto')]
  engine.used = 30000
  await mount()
  engine.percent = 12
  await $.session.measure({ context: { window: 200000, percent: 12 }, rateLimits: [], changed: ['context'] } as never)
  await clock.settle()
  expect(engine.counts).toBe(1)
  expect(await (await mount()).find({ text: /ctx .* 12%/ })).toBeDefined()

  // Alla compattazione successiva, finché la stima nuova non arriva, vale il 12% vero e non il 15% della stima superata
  engine.percent = undefined
  engine.messages = [message('user', 'Altro riassunto')]
  engine.used = 40000
  expect(await (await mount()).find({ text: /ctx .* 12%/ })).toBeDefined()
  await clock.settle()
  expect(await (await mount()).find({ text: /ctx .* 20%/ })).toBeDefined()
})

test("dopo un rewind all'inizio ctx resta n/d nel turno che segue anche senza un disegno a barra ferma", async ($, on) => {
  const engine = stubContext(on)
  mock.clock(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  const mount = (props = PROPS) => $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props })
  const reply = async (percent: number) => {
    engine.percent = percent
    await $.session.measure({ context: { window: 200000, percent }, rateLimits: [], changed: ['context'] } as never)
  }
  engine.messages = [message('user', 'Domanda'), message('assistant', 'Risposta')]

  await $.session.start(START)
  await reply(16)
  await mount()

  // /rewind all'inizio, e il disegno che segue arriva mentre il motore risulta ancora al lavoro
  engine.percent = undefined
  engine.messages = []
  expect(await (await mount(WORKING)).find({ text: /ctx n\/d/ })).toBeDefined()
  engine.messages = [message('user', 'Nuova domanda')]
  expect(await (await mount(WORKING)).find({ text: /ctx n\/d/ })).toBeDefined()
  await reply(5)
  expect(await (await mount()).find({ text: /ctx .* 5%/ })).toBeDefined()

  // Doppio Esc fino all'inizio: nessun disegno. Il turno del prompt che segue parte con la conversazione vuota
  engine.messages = [message('user', 'Domanda'), message('assistant', 'Risposta')]
  await reply(16)
  engine.percent = undefined
  engine.messages = [message('user', 'Altra domanda')]
  await $.turn.start({ text: 'Altra domanda', turnId: 't2' } as never)
  expect(await (await mount(WORKING)).find({ text: /ctx n\/d/ })).toBeDefined()
  await reply(4)
  expect(await (await mount()).find({ text: /ctx .* 4%/ })).toBeDefined()

  // Doppio Esc fino all'inizio, con il prompt nuovo non ancora tra i messaggi quando il turno parte
  await reply(16)
  engine.percent = undefined
  engine.messages = []
  await $.turn.start({ text: 'Terza domanda', turnId: 't3' } as never)
  engine.messages = [message('user', 'Terza domanda')]
  expect(await (await mount(WORKING)).find({ text: /ctx n\/d/ })).toBeDefined()
})

test('dopo una compattazione un turno senza testo, o col prompt non ancora tra i messaggi, non porta ctx a n/d', async ($, on) => {
  const engine = stubContext(on)
  const clock = mock.clock(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  const mount = (props = PROPS) => $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props })
  engine.messages = [message('user', 'Domanda'), message('assistant', 'Risposta')]

  await $.session.start(START)
  await $.session.measure(MEASURE)
  await mount()

  // /compact: resta un messaggio solo, il riassunto, e la stima lo conta
  engine.percent = undefined
  engine.messages = [message('user', 'Riassunto')]
  engine.used = 30000
  await mount()
  await clock.settle()
  expect(await (await mount()).find({ text: /ctx .* 15%/ })).toBeDefined()

  // La notifica di un agente in background avvia un turno senza testo: la stima resta
  await $.turn.start({ text: '', turnId: 't1' } as never)
  expect(await (await mount(WORKING)).find({ text: /ctx .* 15%/ })).toBeDefined()

  // Un prompt il cui turno parte prima che sia tra i messaggi: il riassunto non è il prompt
  await $.turn.start({ text: 'Nuova domanda', turnId: 't2' } as never)
  expect(await (await mount(WORKING)).find({ text: /ctx .* 15%/ })).toBeDefined()
})

test('una risposta che porta la percentuale mentre la stima la sta controllando non viene sovrascritta dalla stima', async ($, on) => {
  const engine = stubContext(on)
  const clock = mock.clock(on)
  const mount = () => $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  engine.messages = [message('user', 'Domanda'), message('assistant', 'Risposta')]

  await $.session.start(START)
  await $.session.measure(MEASURE)
  await mount()

  // /compact: la stima parte da un timer; la misura con il 12% arriva mentre la stima controlla la percentuale, che legge ancora
  // assente
  engine.percent = undefined
  engine.messages = [message('user', 'Riassunto')]
  engine.used = 30000
  await mount()
  engine.beforeUsage = () => {
    engine.percent = 12
    return $.session.measure({ context: { window: 200000, percent: 12 }, rateLimits: [], changed: ['context'] } as never)
  }
  await clock.settle()
  expect(engine.counts).toBe(1)
  expect(engine.beforeUsage).toBeNull()

  // Alla compattazione successiva, finché la stima nuova non arriva, vale il 12% vero e non il 15% della stima superata
  engine.percent = undefined
  engine.messages = [message('user', 'Altro riassunto')]
  engine.used = 40000
  expect(await (await mount()).find({ text: /ctx .* 12%/ })).toBeDefined()
})

test('5h e 7g prendono il colore della percentuale arrotondata che mostrano', async ($, on) => {
  const engine = stubContext(on)
  engine.percent = 10

  await $.session.start(START)
  await $.session.measure({
    context: { window: 200000, percent: 10 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 89.6 },
      { kind: 'seven_day', percentUsed: 69.5 },
    ],
    changed: ['context', 'rateLimits'],
  } as never)
  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

  expect((await ui.find({ type: 'Text', text: /^\S+ 90%$/ }))?.props.color).toBe('error')
  expect((await ui.find({ type: 'Text', text: /^\S+ 70%$/ }))?.props.color).toBe('warning')
})
