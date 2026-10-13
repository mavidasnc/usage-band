import { expect, test } from 'claude-code/testing'

// Proprietà della band come le passa il motore
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 10 } as never

// Input di session.start come lo passa il REPL
const START = { cwd: '', surface: 'terminal', isInteractive: true } as never

// Una misura con 5h al 75% (giallo), settimana al 31% (verde), contesto al 92% (rosso)
const MEASURE = {
  context: { window: 200000, percent: 92 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 75 },
    { kind: 'seven_day', percentUsed: 31 },
  ],
  changed: ['context', 'rateLimits'],
} as never

test('la barra mostra le tre percentuali con i colori per soglia', async ($, on) => {
  // Il motore sotto i plugin: nessun dato all'avvio, la misura viene dal test
  on('session.start', () => ({ cwd: '' }))
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

  // I tre colori per soglia compaiono nell'albero disegnato
  const tree = JSON.stringify(await ui.drawn())
  expect(tree).toContain('"warning"')
  expect(tree).toContain('"success"')
  expect(tree).toContain('"error"')
})

test('senza alcun dato la barra non disegna nulla', async ($, on) => {
  on('session.start', () => ({ cwd: '' }))
  on('command.register', () => ({ value: { command: 'usage-band' } }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  // Il motore sotto la band: se il plugin cede il posto, disegna un Text vuoto
  on('ui.render', () => ({ type: 'Text', props: {}, children: [] }) as never)

  await $.session.start(START)

  const ui = await $.ui.mount({
    plugin: 'usage-band',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: PROPS,
  })

  expect(await ui.find({ text: /5h|7g|ctx/ })).toBeUndefined()
})

test('/usage-band nasconde e rimostra la barra', async ($, on) => {
  on('session.start', () => ({ cwd: '' }))
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
