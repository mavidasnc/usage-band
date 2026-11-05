// Aggiornamento del mod al click sulla versione: aggiorna il marketplace e il plugin con la CLI di Claude Code; se la versione
// installata cambia esegue /reload-plugins, e il messaggio di aggiornamento arriva alla ripartenza del mod (session.start)

import type { EngineInterface } from 'claude-code'

import { TOAST_MS } from './notify'

// Chiave di $.store con la versione appena installata e l'ora: il reload smonta il modulo che ha lanciato il comando,
// quindi l'annuncio passa per lo store
const ANNOUNCE_KEY = 'update:announce'

// Oltre questo tempo dall'aggiornamento l'annuncio non vale più (un'altra sessione aperta più tardi non lo ripete)
const ANNOUNCE_MAX_AGE_MS = 5 * 60_000

// Tempo massimo di ogni comando della CLI: il marketplace si scarica da GitHub
const CLI_TIMEOUT_MS = 120_000

// Lunghezza massima del motivo di un errore nel toast
const REASON_MAX = 120

// Annuncio salvato nello store
type Announce = { version: string; at: number }

// Voce di `claude plugin list --json` che serve qui
type InstalledPlugin = { id: string; version?: string; installPath?: string; readFromFolder?: string }

// True mentre un aggiornamento è in corso: la barra mostra ⟳ e un altro click non fa nulla
let updating = false

/**
 * Dice se un aggiornamento è in corso, per il segno accanto alla versione.
 *
 * @returns {boolean} True durante il controllo e l'aggiornamento.
 */
export function isUpdating(): boolean {
  return updating
}

// Errore con un messaggio già pronto per il toast
class UpdateError extends Error {}

/**
 * Normalizza un percorso per il confronto: barre in avanti, minuscole, senza barra finale.
 *
 * @param {string} path - Percorso da normalizzare.
 * @returns {string} Percorso normalizzato.
 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * Prima riga non vuota di un testo, accorciata per il toast.
 *
 * @param {string} text - Testo da cui prendere la riga.
 * @returns {string} La riga, o una stringa vuota.
 */
function firstLine(text: string): string {
  const line = text.split(/\r?\n/).map(part => part.trim()).find(Boolean) ?? ''
  return line.length > REASON_MAX ? `${line.slice(0, REASON_MAX - 1)}…` : line
}

/**
 * Mostra un toast, ignorando un toast non disponibile.
 *
 * @param {EngineInterface} $ - Interfaccia del motore.
 * @param {string} text - Testo del toast.
 * @returns {void}
 */
function toast($: EngineInterface, text: string): void {
  try {
    $.ui.toast(text, { timeoutMs: TOAST_MS })
  } catch {
    // toast non disponibile: nessun altro canale
  }
}

/**
 * Esegue la CLI di Claude Code e ne restituisce l'output; un'uscita diversa da 0 diventa un errore col motivo dello stderr.
 *
 * @param {EngineInterface} $ - Interfaccia del motore.
 * @param {string[]} args - Argomenti dopo `claude`.
 * @returns {Promise<string>} Standard output del comando.
 */
async function runClaude($: EngineInterface, args: string[]): Promise<string> {
  const { exitCode, stdout, stderr } = await $.process.run(['claude', ...args], { timeoutMs: CLI_TIMEOUT_MS })
  if (exitCode !== 0) {
    throw new UpdateError(firstLine(stderr) || firstLine(stdout) || `claude ${args.join(' ')} è uscito con ${exitCode}`)
  }
  return stdout
}

/**
 * Trova l'installazione del mod: con `id` la voce di `claude plugin list --json` con quell'id; senza, quella il cui
 * percorso coincide con la cartella del mod che sta girando (null se è caricato con --plugin-dir). Dopo un aggiornamento la
 * cartella installata è quella della versione nuova, quindi la seconda lettura cerca per id.
 *
 * @param {EngineInterface} $ - Interfaccia del motore.
 * @param {string} [id] - Id `<nome>@<marketplace>` da cercare.
 * @returns {Promise<InstalledPlugin | null>} La voce installata, o null.
 */
async function findInstall($: EngineInterface, id?: string): Promise<InstalledPlugin | null> {
  let list: unknown
  try {
    list = JSON.parse(await runClaude($, ['plugin', 'list', '--json']))
  } catch (error) {
    if (error instanceof UpdateError) {
      throw error
    }
    throw new UpdateError('elenco dei plugin illeggibile')
  }
  if (!Array.isArray(list)) {
    throw new UpdateError('elenco dei plugin illeggibile')
  }
  const items = (list as InstalledPlugin[]).filter(item => typeof item?.id === 'string')
  if (id) {
    return items.find(item => item.id === id) ?? null
  }
  const root = normalizePath($.plugin.root)
  const prefix = `${$.plugin.name}@`
  return (
    items.find(
      item =>
        item.id.startsWith(prefix) &&
        [item.installPath, item.readFromFolder].some(path => typeof path === 'string' && normalizePath(path) === root),
    ) ?? null
  )
}

/**
 * Aggiorna il mod: marketplace, plugin, poi /reload-plugins se la versione installata è cambiata. Ogni esito finisce in
 * un toast; un secondo click durante l'operazione non fa nulla.
 *
 * @param {EngineInterface} $ - Interfaccia del motore.
 * @returns {Promise<void>}
 */
export async function startUpdate($: EngineInterface): Promise<void> {
  if (updating) {
    return
  }
  updating = true
  $.ui.invalidate('ui.render')
  const name = $.plugin.name
  try {
    const installed = await findInstall($)
    if (!installed) {
      toast($, `${name} è caricato da una cartella (--plugin-dir): nessun aggiornamento`)
      return
    }
    const marketplace = installed.id.slice(installed.id.indexOf('@') + 1)
    await runClaude($, ['plugin', 'marketplace', 'update', marketplace])
    await runClaude($, ['plugin', 'update', installed.id])

    const after = await findInstall($, installed.id)
    const version = after?.version ?? installed.version
    if (!version || version === installed.version) {
      toast($, `${name} è già all'ultima versione${version ? ` (v${version})` : ''}`)
      return
    }

    const now = await $.clock.now().catch(() => Date.now())
    await $.store.set(ANNOUNCE_KEY, { version, at: now } satisfies Announce).catch(() => undefined)
    try {
      await $.command.run({ command: 'reload-plugins' })
    } catch {
      await $.store.delete(ANNOUNCE_KEY).catch(() => undefined)
      toast($, `${name} aggiornato alla v${version}: esegui /reload-plugins per usarla`)
    }
  } catch (error) {
    const reason = error instanceof UpdateError ? error.message : firstLine(error instanceof Error ? error.message : String(error))
    toast($, `Aggiornamento di ${name} non riuscito${reason ? `: ${reason}` : ''}`)
  } finally {
    updating = false
    $.ui.invalidate('ui.render')
  }
}

/**
 * Alla ripartenza del mod dopo un aggiornamento annuncia la versione nuova, una volta sola. Se il mod che gira non è
 * quella versione (il reload non l'ha caricata) chiede di riavviare Claude Code.
 *
 * @param {EngineInterface} $ - Interfaccia del motore.
 * @param {string | null} running - Versione del mod che sta girando, dal suo plugin.json.
 * @returns {Promise<void>}
 */
export async function announceUpdate($: EngineInterface, running: string | null): Promise<void> {
  const stored = (await $.store.get(ANNOUNCE_KEY).catch(() => undefined)) as Announce | undefined
  if (!stored) {
    return
  }
  await $.store.delete(ANNOUNCE_KEY).catch(() => undefined)
  const now = await $.clock.now().catch(() => Date.now())
  if (typeof stored.version !== 'string' || !(now - stored.at <= ANNOUNCE_MAX_AGE_MS)) {
    return
  }
  const name = $.plugin.name
  toast(
    $,
    running === stored.version
      ? `${name} aggiornato alla v${stored.version}`
      : `${name} v${stored.version} installato: riavvia Claude Code per usarlo`,
  )
}
