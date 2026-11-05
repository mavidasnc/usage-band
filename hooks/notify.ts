// Notifiche di soglia: 5h, 7g e ctx quando passano in giallo e in rosso, e l'azzeramento della finestra di 5 ore.
// Un toast nel terminale sempre; per il rosso e per l'azzeramento anche la notifica di sistema, che arriva anche da un'altra finestra

import type { EngineInterface } from 'claude-code'

import type { Limit, Snapshot } from '../types'

// Soglie dei livelli, le stesse dei colori della barra: giallo da 70, rosso da 90
const WARN_AT = 70
const ERROR_AT = 90

// Livello di una percentuale arrotondata: 0 verde, 1 giallo, 2 rosso
export const levelFor = (percent: number) => {
  const shown = Math.round(percent)
  return shown >= ERROR_AT ? 2 : shown >= WARN_AT ? 1 : 0
}

// Durata dei toast, in millisecondi (il motore di suo li tiene 4 secondi)
const TOAST_MS = 10_000

// Tipo di avviso: giallo, rosso o azzeramento del 5h, con il simbolo colorato in testa al toast (il toast non ha colori suoi)
type Alert = 'warn' | 'error' | 'reset'
const SYMBOL: Record<Alert, string> = { warn: '🟡', error: '🔴', reset: '🟢' }

// Due orari di reset distano meno di questo quando indicano la stessa finestra (il motore può arrotondarli diversamente)
const SAME_WINDOW_MS = 10 * 60_000

// Ritardo dopo il reset prima di avvisare, perché il motore abbia già la finestra nuova
const RESET_GRACE_MS = 5_000

// Ultimo livello notificato per una finestra di limite, salvato in $.store: vale tra sessioni e dopo un reload del mod
type Notified = { resetsAt: string | null; level: number }

// Chiavi di $.store: livello notificato per 5h e 7g, reset del 5h già annunciato
const STORE_KEY = { fiveHour: 'notified:fiveHour', sevenDay: 'notified:sevenDay' } as const
const RESET_KEY = 'notified:fiveHourReset'

const LABEL = { fiveHour: '5h', sevenDay: '7g' } as const

// Livello del contesto già notificato nella sessione: si azzera quando il contesto scende (dopo una compattazione)
let contextNotified: { sessionId: string; level: number } | null = null

// Timer dell'azzeramento del 5h e l'orario a cui è puntato
let resetTimer: { resetsAt: string; cancel: () => void } | null = null

// True se due orari di reset indicano la stessa finestra
const sameWindow = (a: string | null, b: string | null) => {
  if (a === null || b === null) {
    return a === b
  }
  return Math.abs(Date.parse(a) - Date.parse(b)) < SAME_WINDOW_MS
}

// Ora del reset per il testo della notifica: HH:MM, col giorno abbreviato se non è oggi
const DAYS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']
const pad = (n: number) => String(n).padStart(2, '0')
const resetText = (iso: string) => {
  const date = new Date(iso)
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return date.toDateString() === new Date().toDateString() ? time : `${DAYS[date.getDay()]} ${time}`
}

// Notifica nativa di Windows (centro notifiche) con l'API WinRT, a nome di PowerShell: titolo e testo arrivano dalle variabili
// d'ambiente, mai dentro lo script, e sono codificati per l'XML della notifica
const WINDOWS_TOAST_SCRIPT = [
  '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
  '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
  '$title = [Security.SecurityElement]::Escape($env:USAGE_BAND_TITLE)',
  '$text = [Security.SecurityElement]::Escape($env:USAGE_BAND_TEXT)',
  '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
  `$xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$title</text><text>$text</text></binding></visual></toast>")`,
  '$toast = New-Object Windows.UI.Notifications.ToastNotification $xml',
  String.raw`[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe').Show($toast)`,
].join('; ')

// True su Windows: la variabile OS che il sistema imposta per ogni processo
async function isWindows($: EngineInterface) {
  return (await $.env.get('OS').catch(() => undefined)) === 'Windows_NT'
}

// Ripiego su Windows quando la notifica del terminale non ha un canale vero (Windows Terminal non ha una sequenza di notifica:
// al più suona il campanello). Non attende PowerShell, che impiega circa mezzo secondo
async function notifyWindows($: EngineInterface, title: string, text: string) {
  if (!(await isWindows($))) {
    return
  }
  void $.process
    .run(['powershell', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_TOAST_SCRIPT], {
      env: { USAGE_BAND_TITLE: title, USAGE_BAND_TEXT: text },
      timeoutMs: 15_000,
    })
    .catch(() => undefined)
}

// Toast sempre, col simbolo del tipo in testa; al rosso e all'azzeramento anche la notifica di sistema, col solo testo, e su
// Windows quella nativa se il terminale non ne ha una. Un canale che non risponde non ferma gli altri
async function send($: EngineInterface, text: string, alert: Alert) {
  try {
    $.ui.toast(`${SYMBOL[alert]} ${text}`, { timeoutMs: TOAST_MS })
  } catch {
    // toast non disponibile: resta la notifica di sistema, se urgente
  }
  if (alert !== 'warn') {
    const result = await $.ui.notify(text, { title: 'usage-band' }).catch(() => undefined)
    // solo un rifiuto esplicito di un altro plugin non va scavalcato; il campanello non mostra il testo
    const isShown = result?.isSent === true && result.channel !== 'terminal_bell'
    if (!isShown && !(result?.isSent === false && result.reason === 'refused')) {
      await notifyWindows($, 'usage-band', text)
    }
  }
}

// Notifica un limite se è salito di livello rispetto all'ultimo notificato per la stessa finestra
async function checkLimit($: EngineInterface, kind: keyof typeof STORE_KEY, limit: Limit | undefined) {
  if (!limit) {
    return
  }
  const level = levelFor(limit.percent)
  const resetsAt = limit.resetsAt ?? null
  const stored = (await $.store.get(STORE_KEY[kind]).catch(() => undefined)) as Notified | undefined
  const isSameWindow = stored !== undefined && sameWindow(stored.resetsAt, resetsAt)
  const previous = isSameWindow ? stored.level : 0
  // Misura della finestra nuova arrivata prima del timer: la finestra chiusa, se era almeno gialla, si annuncia da qui
  if (kind === 'fiveHour' && stored && !isSameWindow && stored.level > 0 && stored.resetsAt) {
    const now = await $.clock.now().catch(() => Date.now())
    if (Date.parse(stored.resetsAt) <= now) {
      await announceReset($, stored.resetsAt, true)
    }
  }
  if (level === previous) {
    return
  }
  // Si salva anche una discesa (una finestra nuova riparte da zero), si avvisa solo a una salita
  await $.store.set(STORE_KEY[kind], { resetsAt, level } satisfies Notified).catch(() => undefined)
  if (level > previous) {
    const reset = resetsAt ? `, reset ${resetText(resetsAt)}` : ''
    await send($, `Limite ${LABEL[kind]} al ${Math.round(limit.percent)}%${reset}`, level === 2 ? 'error' : 'warn')
  }
}

// Notifica il contesto se è salito di livello nella sessione; una discesa (compattazione) permette di riavvisare
async function checkContext($: EngineInterface, percent: number | undefined) {
  if (percent === undefined) {
    return
  }
  const sessionId = await $.session.id().catch(() => null)
  if (sessionId === null) {
    return
  }
  const level = levelFor(percent)
  const previous = contextNotified?.sessionId === sessionId ? contextNotified.level : 0
  contextNotified = { sessionId, level }
  if (level > previous) {
    await send($, `Contesto al ${Math.round(percent)}%: valuta /compact`, level === 2 ? 'error' : 'warn')
  }
}

// All'azzeramento del 5h: avvisa se la finestra che si chiude era almeno gialla, una volta sola anche con più sessioni aperte.
// Senza `wasWarned` il livello della finestra si legge da $.store
async function announceReset($: EngineInterface, resetsAt: string, wasWarned?: boolean) {
  if (wasWarned === undefined) {
    const stored = (await $.store.get(STORE_KEY.fiveHour).catch(() => undefined)) as Notified | undefined
    wasWarned = stored !== undefined && sameWindow(stored.resetsAt, resetsAt) && stored.level > 0
  }
  const announced = (await $.store.get(RESET_KEY).catch(() => undefined)) as string | undefined
  if (!wasWarned || (announced !== undefined && sameWindow(announced, resetsAt))) {
    return
  }
  await $.store.set(RESET_KEY, resetsAt).catch(() => undefined)
  await send($, 'Limite 5h azzerato', 'reset')
}

// Punta il timer sull'orario di reset del 5h; un orario nuovo sostituisce il precedente
async function scheduleReset($: EngineInterface, limit: Limit | undefined) {
  const resetsAt = limit?.resetsAt
  if (!resetsAt || (resetTimer && sameWindow(resetTimer.resetsAt, resetsAt))) {
    return
  }
  const delay = Date.parse(resetsAt) - (await $.clock.now().catch(() => Date.now()))
  if (Number.isNaN(delay) || delay <= 0) {
    return
  }
  resetTimer?.cancel()
  const timer = $.clock.after(delay + RESET_GRACE_MS, () => {
    if (resetTimer === current) {
      resetTimer = null
    }
    void announceReset($, resetsAt).catch(() => undefined)
  })
  const current = { resetsAt, cancel: () => timer.cancel() }
  resetTimer = current
}

// Controlla una misura: soglie di 5h, 7g e contesto e timer dell'azzeramento del 5h. Non lancia mai: le notifiche sono accessorie
export async function checkThresholds($: EngineInterface, measured: Snapshot) {
  try {
    await checkLimit($, 'fiveHour', measured.fiveHour)
    await checkLimit($, 'sevenDay', measured.sevenDay)
    await checkContext($, measured.context)
    await scheduleReset($, measured.fiveHour)
  } catch {
    // store, orologio o sessione non disponibili: nessuna notifica
  }
}
