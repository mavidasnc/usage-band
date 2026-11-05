// Attività durante un turno, per la terza riga della barra: strumenti in corso nel loop principale, subagenti al lavoro, strumenti
// usati dal prompt corrente (con i suoi subagenti) e avanzamento della lista di attività del modello (TodoWrite o TaskCreate/
// TaskUpdate). Stato in variabili del modulo: chi le aggiorna ridisegna la barra

// Voci del riepilogo degli strumenti mostrate al massimo, le più usate
const MAX_COUNTS = 5

// Strumenti in corso nel loop principale (id della chiamata → nome), in ordine di partenza
const running = new Map<string, string>()

// Strumenti usati dall'operazione corrente, con il numero di chiamate
const counts = new Map<string, number>()

// Subagenti con un turno in corso (anche in background, anche di operazioni precedenti)
const agents = new Set<string>()

// Lista di attività del modello: quella intera di TodoWrite, oppure i task di TaskCreate/TaskUpdate (id → stato)
let todos: { done: number; total: number } | null = null
const tasks = new Map<string, string>()

// Contatore per le chiamate senza id
let anonymous = 0

// Un nuovo prompt della persona: riepilogo e strumenti in corso ripartono da zero; subagenti e lista di attività restano
export const startActivity = () => {
  running.clear()
  counts.clear()
}

// Sessione nuova (/clear, /resume): riparte tutto
export const resetActivity = () => {
  startActivity()
  agents.clear()
  todos = null
  tasks.clear()
}

// Inizio di una chiamata a uno strumento; restituisce l'id con cui chiuderla. Solo quelle del loop principale sono «in corso»
export const toolStarted = (id: string | undefined, tool: string, isMain: boolean) => {
  const key = id ?? `anonymous-${++anonymous}`
  if (isMain) {
    running.set(key, tool)
  }
  return key
}

// Fine di una chiamata: esce dalle «in corso» e, se appartiene all'operazione corrente, entra nel riepilogo
export const toolFinished = (key: string, tool: string, isCurrent: boolean) => {
  running.delete(key)
  if (isCurrent) {
    counts.set(tool, (counts.get(tool) ?? 0) + 1)
  }
}

// Turno di un subagente iniziato o finito
export const agentStarted = (agentId: string) => {
  agents.add(agentId)
}
export const agentFinished = (agentId: string) => {
  agents.delete(agentId)
}

// Lista intera da TodoWrite: completati sul totale (sostituisce i task)
export const todoListWritten = (list: readonly { status: string }[]) => {
  tasks.clear()
  todos = { done: list.filter(item => item.status === 'completed').length, total: list.length }
}

// Task creato (parte da pending) o aggiornato (deleted lo toglie)
export const taskCreated = (id: string) => {
  todos = null
  tasks.set(id, 'pending')
}
export const taskUpdated = (id: string, status: string | undefined) => {
  if (status === 'deleted') {
    tasks.delete(id)
  } else if (status) {
    tasks.set(id, status)
  }
}

// Avanzamento della lista di attività; null se non ce n'è una
const progress = () => {
  if (todos && todos.total > 0) {
    return todos
  }
  if (tasks.size > 0) {
    return { done: [...tasks.values()].filter(status => status === 'completed').length, total: tasks.size }
  }
  return null
}

// Parti della riga di attività, ognuna già scritta; vuota se non c'è nulla da mostrare.
// "⟳ Bash" (strumenti in corso, distinti), "∴ 2" (subagenti), "✓ Read ×3 Edit ×2" (riepilogo), "☐ 3/7" (lista di attività)
export const activityParts = () => {
  const parts: { kind: 'running' | 'agents' | 'counts' | 'todos'; text: string }[] = []
  const names = [...new Set(running.values())]
  if (names.length) {
    parts.push({ kind: 'running', text: `⟳ ${names.join(', ')}` })
  }
  if (agents.size) {
    parts.push({ kind: 'agents', text: `∴ ${agents.size}` })
  }
  if (counts.size) {
    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_COUNTS)
      .map(([tool, n]) => (n > 1 ? `${tool} ×${n}` : tool))
    parts.push({ kind: 'counts', text: `✓ ${top.join(' ')}` })
  }
  const list = progress()
  if (list) {
    parts.push({ kind: 'todos', text: `☐ ${list.done}/${list.total}` })
  }
  return parts
}
