import { expect, mock, test } from 'claude-code/testing'

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

test('la barra mostra le tre percentuali con i colori per soglia', async ($, on) => {
  // Il motore sotto i plugin: nessun dato all'avvio, la misura viene dal test
  on('session.start', () => ({ cwd: '' }))
  on('session.cwd', () => ({ value: 'C:\\Users\\maurizio\\Claude\\mio-progetto' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('fs.read', () => ({ value: JSON.stringify({ name: 'usage-band', version: '9.9.9' }) }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ loggedIn: true, email: 'maurizio@mavida.com' }), stderr: '' } }))
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
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ loggedIn: true, email: 'maurizio@mavida.com' }), stderr: '' } }))
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
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ loggedIn: true, email: 'maurizio@mavida.com' }), stderr: '' } }))
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
  on('session.cwd', () => ({ value: 'C:\Users\maurizio\Claude\mio-progetto' }))
  on('session.model', () => ({ value: 'opus' }))
  on('fs.read', () => ({ value: JSON.stringify({ name: 'usage-band', version: '9.9.9' }) }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ loggedIn: true, email: 'maurizio@mavida.com' }), stderr: '' } }))
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

  // Il Box esterno tiene separatore e barra; largo: un Box per la riga col pulsante e uno per l'ambiente,
  // stretto: un Box per le due righe, uno per i consumi col pulsante e uno per l'ambiente
  const boxes = (tree: string) => tree.split('"type":"Box"').length - 1
  expect(boxes(await draw(60))).toBe(4)
  expect(boxes(await draw(250))).toBe(3)
})

test("l'effort dell'ultima richiesta compare dopo il modello", async ($, on) => {
  on('session.start', () => ({ cwd: '' }))
  on('session.cwd', () => ({ value: 'C:\Users\maurizio\Claude\mio-progetto' }))
  on('session.model', () => ({ value: 'opus' }))
  on('fs.read', () => ({ value: JSON.stringify({ name: 'usage-band', version: '9.9.9' }) }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ email: 'maurizio@mavida.com' }), stderr: '' } }))
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

test("l'effort arriva anche dall'evento classico Stop, escluso quello dei subagenti", async ($, on) => {
  on('session.start', () => ({ cwd: '' }))
  on('session.cwd', () => ({ value: 'C:\Users\maurizio\Claude\mio-progetto' }))
  on('session.model', () => ({ value: 'opus' }))
  on('fs.read', () => ({ value: JSON.stringify({ name: 'usage-band', version: '9.9.9' }) }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ email: 'maurizio@mavida.com' }), stderr: '' } }))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('classic.Stop', () => ({}))

  await $.session.start(START)

  const mount = () =>
    $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

  // Un Stop del thread principale con effort xhigh: compare
  await $.classic.Stop({ stop_hook_active: false, effort: { level: 'xhigh' } } as never)
  expect(await (await mount()).find({ text: 'xhigh' })).toBeDefined()

  // Un Stop di un subagente non lo cambia
  await $.classic.Stop({ stop_hook_active: false, agent_id: 'a1', effort: { level: 'low' } } as never)
  expect(await (await mount()).find({ text: 'xhigh' })).toBeDefined()
})

test('dopo /clear la barra ritrova consumi, email e versione', async ($, on) => {
  on('session.start', () => ({ cwd: '' }))
  on('session.cwd', () => ({ value: 'C:\Users\maurizio\Claude\mio-progetto' }))
  on('session.model', () => ({ value: 'opus' }))
  on('fs.read', () => ({ value: JSON.stringify({ name: 'usage-band', version: '9.9.9' }) }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ loggedIn: true, email: 'maurizio@mavida.com' }), stderr: '' } }))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('classic.SessionStart', () => ({}))

  await $.session.start(START)
  await $.session.measure(MEASURE)

  // Il /clear: la sessione nuova parte senza lettura dei limiti, il ripiego tiene gli ultimi visti
  await $.classic.SessionStart({ source: 'clear' })
  const ui = await $.ui.mount({
    plugin: 'usage-band',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: PROPS,
  })

  expect(await ui.find({ text: /5h .* 75%/ })).toBeDefined()
  expect(await ui.find({ text: /7g .* 31%/ })).toBeDefined()
  expect(await ui.find({ text: 'maurizio@mavida.com' })).toBeDefined()
  expect(await ui.find({ text: 'v9.9.9' })).toBeDefined()
})

test('il nome del modello è leggibile anche per ID datati, vecchio schema e contesto esteso', async ($, on) => {
  let model = ''
  on('session.start', () => ({ cwd: '' }))
  on('session.cwd', () => ({ value: 'C:\Users\maurizio\Claude\mio-progetto' }))
  on('session.model', () => ({ value: model }))
  on('fs.read', () => ({ value: JSON.stringify({ name: 'usage-band', version: '9.9.9' }) }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
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
  on('session.cwd', () => ({ value: 'C:\Users\maurizio\Claude\mio-progetto' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('fs.read', () => ({ value: JSON.stringify({ name: 'usage-band', version: '9.9.9' }) }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify({ email: 'maurizio@mavida.com' }), stderr: '' } }))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('classic.Stop', () => ({}))

  await $.session.start(START)
  await $.session.measure(MEASURE)
  await $.classic.Stop({ stop_hook_active: false, effort: { level: 'medium' } } as never)

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
  on: Parameters<Parameters<typeof test>[1]>[1],
  usages: Record<string, unknown> = {},
  cost: { usd?: number } = {},
) => {
  on('session.start', () => ({ cwd: '' }))
  on('session.cwd', () => ({ value: 'C:\Users\maurizio\Claude\mio-progetto' }))
  on('session.model', () => ({ value: 'opus' }))
  on('fs.read', () => ({ value: JSON.stringify({ name: 'usage-band', version: '9.9.9' }) }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
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
})

test('la durata della cache viene dalle variabili di ambiente e dal cambio di modello', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { ENABLE_PROMPT_CACHING_1H: '1', FORCE_PROMPT_CACHING_5M: '1' })
  stubEngine(on)
  on('classic.PostModelSwitch', () => ({}))
  await $.session.start(START)

  const mount = () =>
    $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  for await (const _chunk of $.turn.step({ turnId: 't', index: 0, model: 'opus', messageCount: 1 } as never)) {
    // nessun chunk atteso
  }

  // FORCE_PROMPT_CACHING_5M vince: cinque minuti, già sotto la soglia dei secondi
  expect(await (await mount()).find({ text: /cache 5:00/ })).toBeDefined()

  // Il motore riporta un'ora al cambio di modello: vale il suo dato
  await $.classic.PostModelSwitch({ cache_ttl: '1h' } as never)
  expect(await (await mount()).find({ text: /cache 60m/ })).toBeDefined()
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

// Un prompt scritto dalla persona: prompt.submit dal terminale, poi il turno che lo esegue
const prompt = async ($: Parameters<Parameters<typeof test>[1]>[0], text: string, turnId: string) => {
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
