import { expect, test } from 'claude-code/testing'

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
  on('session.model', () => ({ value: 'opus' }))
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
  // Uno spazio tra il simbolo di reset e l'orario
  expect(await ui.find({ text: /↻ \d{2}:\d{2}/ })).toBeDefined()
  // Cartella padre e cartella di lavoro, in giallo
  expect(await ui.find({ text: 'Claude\\mio-progetto' })).toBeDefined()
  // Modello corrente ed email dell'account, ognuno col suo colore
  expect(await ui.find({ text: 'opus' })).toBeDefined()
  expect(await ui.find({ text: 'maurizio@mavida.com' })).toBeDefined()
  // Versione del mod in fondo, letta dal suo plugin.json
  expect(await ui.find({ text: 'usage-band v9.9.9' })).toBeDefined()

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

  // Stretto: la colonna di due righe è un Box; largo: solo Text annidati
  expect(await draw(60)).toContain('"Box"')
  expect(await draw(250)).not.toContain('"Box"')
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
  expect(await (await mount()).find({ text: /effort/ })).toBeUndefined()

  // Una richiesta del loop principale con effort high: compare, tra modello ed email
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'opus', effort: 'high', messageCount: 1 } as never)
  for await (const _chunk of stream) {
    // nessun chunk atteso
  }
  expect(await (await mount()).find({ text: 'effort high' })).toBeDefined()

  // Una richiesta di un subagente non cambia l'effort mostrato
  const sub = $.turn.step({ turnId: 't2', index: 0, model: 'haiku', effort: 'low', messageCount: 1, agentId: 'a1' } as never)
  for await (const _chunk of sub) {
    // nessun chunk atteso
  }
  expect(await (await mount()).find({ text: 'effort high' })).toBeDefined()
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
  expect(await (await mount()).find({ text: 'effort xhigh' })).toBeDefined()

  // Un Stop di un subagente non lo cambia
  await $.classic.Stop({ stop_hook_active: false, agent_id: 'a1', effort: { level: 'low' } } as never)
  expect(await (await mount()).find({ text: 'effort xhigh' })).toBeDefined()
})
