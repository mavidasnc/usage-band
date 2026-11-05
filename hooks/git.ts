// Stato git della cartella di lavoro per la riga ambiente: branch (o hash breve se HEAD è staccato), modifiche non salvate,
// commit avanti/indietro rispetto al branch remoto collegato (dati locali, senza fetch) e righe cambiate rispetto a HEAD.
// Letto con `git` in background e tenuto in una variabile del modulo: il disegno lo legge e non lancia mai processi

import type { EngineInterface } from 'claude-code'

// Stato git di una cartella
export type GitInfo = {
  branch: string
  isDirty: boolean
  ahead: number
  behind: number
  added: number
  removed: number
}

// Strumenti dopo i quali il working tree può essere cambiato
export const GIT_TOOLS: readonly string[] = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'PowerShell']

// Attesa dopo uno strumento prima di rileggere: più strumenti di fila danno una sola lettura
export const GIT_DEBOUNCE_MS = 2_000

// Tempo massimo per un comando git
const GIT_TIMEOUT_MS = 5_000

// Ultimo stato letto, per cartella: null fuori da un repository o senza git
let cache: { cwd: string; info: GitInfo | null } | null = null

// Lettura in corso (una sola alla volta) e lettura richiesta mentre un'altra era in corso
let isReading = false
let isPending = false

// Timer della prossima lettura programmata
let timer: { cancel: () => void } | null = null

// Stato da `git status --porcelain=v2 --branch`: le righe `# branch.*` danno branch e avanti/indietro, ogni altra riga
// (modificati, rinominati, in conflitto, non tracciati) indica modifiche non salvate
export const parseStatus = (stdout: string): Omit<GitInfo, 'added' | 'removed'> => {
  let oid = ''
  let head = ''
  let ahead = 0
  let behind = 0
  let isDirty = false
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('# branch.oid ')) {
      oid = line.slice('# branch.oid '.length).trim()
    } else if (line.startsWith('# branch.head ')) {
      head = line.slice('# branch.head '.length).trim()
    } else if (line.startsWith('# branch.ab ')) {
      const match = line.match(/\+(\d+) -(\d+)/)
      ahead = Number(match?.[1] ?? 0)
      behind = Number(match?.[2] ?? 0)
    } else if (/^[12u?] /.test(line)) {
      isDirty = true
    }
  }
  // HEAD staccato: l'hash breve del commit (in un repository senza commit resta il nome del branch)
  const branch = head === '(detached)' && oid && oid !== '(initial)' ? oid.slice(0, 7) : head
  return { branch, isDirty, ahead, behind }
}

// Righe aggiunte e tolte da `git diff HEAD --shortstat` (" 3 files changed, 120 insertions(+), 34 deletions(-)")
export const parseShortstat = (stdout: string) => ({
  added: Number(stdout.match(/(\d+) insertions?\(\+\)/)?.[1] ?? 0),
  removed: Number(stdout.match(/(\d+) deletions?\(-\)/)?.[1] ?? 0),
})

// Testo della voce: "main* ↑1 ↓2 +120 −34", con le parti a zero omesse
export const gitLabel = (info: GitInfo) =>
  [
    `${info.branch}${info.isDirty ? '*' : ''}`,
    info.ahead ? `↑${info.ahead}` : '',
    info.behind ? `↓${info.behind}` : '',
    info.added ? `+${info.added}` : '',
    info.removed ? `−${info.removed}` : '',
  ]
    .filter(Boolean)
    .join(' ')

// Stato noto per la cartella indicata; undefined se non è ancora stato letto (o era di un'altra cartella)
export const gitFor = (cwd: string): GitInfo | null | undefined => (cache?.cwd === cwd ? cache.info : undefined)

// Legge lo stato git della cartella di lavoro e ridisegna la barra se è cambiato. Fuori da un repository, senza git o su
// errore lo stato è null e la voce non compare
export async function refreshGit($: EngineInterface) {
  if (isReading) {
    isPending = true
    return
  }
  isReading = true
  try {
    const cwd = await $.session.cwd()
    let info: GitInfo | null = null
    try {
      const status = await $.process.run(['git', 'status', '--porcelain=v2', '--branch'], { cwd, timeoutMs: GIT_TIMEOUT_MS })
      const parsed = status.exitCode === 0 ? parseStatus(status.stdout) : null
      // senza la riga del branch l'uscita non è quella di git status: nessuna voce
      if (parsed?.branch) {
        // In un repository senza commit HEAD non esiste: niente righe cambiate
        const diff = await $.process
          .run(['git', 'diff', 'HEAD', '--shortstat'], { cwd, timeoutMs: GIT_TIMEOUT_MS })
          .catch(() => null)
        info = { ...parsed, ...(diff?.exitCode === 0 ? parseShortstat(diff.stdout) : { added: 0, removed: 0 }) }
      }
    } catch {
      // git non installato o fuori tempo: nessuna voce
    }
    // Ridisegna solo se cambia ciò che la barra mostra: da «mai letto» a «nessun repository» non cambia nulla
    const isChanged = JSON.stringify(cache?.cwd === cwd ? cache.info : null) !== JSON.stringify(info)
    cache = { cwd, info }
    if (isChanged) {
      $.ui.invalidate('ui.render')
    }
  } catch {
    // cartella di lavoro non disponibile: resta lo stato di prima
  } finally {
    isReading = false
  }
  // Una richiesta arrivata durante la lettura: una lettura ancora, con lo stato più recente
  if (isPending) {
    isPending = false
    await refreshGit($)
  }
}

// Programma una lettura fra `delayMs` millisecondi; una richiesta nuova sostituisce quella in attesa
export function scheduleGit($: EngineInterface, delayMs = 0) {
  timer?.cancel()
  timer = $.clock.after(delayMs, () => {
    timer = null
    void refreshGit($).catch(() => undefined)
  })
}
