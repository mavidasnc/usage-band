// Costo di una ripresa a cache scaduta: quanto costerebbe la prossima richiesta se la cache del prompt fosse scaduta e il contesto
// andasse riscritto per intero in cache. Il motore non espone i prezzi: il prezzo base d'ingresso di ogni modello si ricava
// dall'aumento del costo della sessione a ogni risposta, con i rapporti di listino tra le voci di prezzo

import type { EngineInterface, ModelUsage } from 'claude-code'

// Rapporti di listino rispetto al prezzo base d'ingresso: lettura dalla cache, uscita e scrittura in cache (5 minuti o 1 ora)
const CACHE_READ_RATIO = 0.1
const OUTPUT_RATIO = 5
export const CACHE_WRITE_RATIO = { '5m': 1.25, '1h': 2 } as const

// Peso della misura nuova nella media del prezzo: assorbe arrotondamenti del costo senza inseguire una risposta sola
const PRICE_SMOOTHING = 0.3

// Variazione relativa sotto la quale il prezzo non si riscrive in $.store
const PRICE_WRITE_DELTA = 0.01

// Chiavi di $.store: prezzo base per modello e ultimo modello tarato, per le sessioni che non hanno ancora una risposta
const priceKey = (model: string) => `price:${model}`
const LAST_KEY = 'price:last'

// Prezzi base noti (USD per token) per modello e ultimo modello tarato, caricati da $.store e aggiornati a ogni taratura
const prices = new Map<string, number>()
let lastModel: string | null = null

// Richieste al modello in corso (di ogni loop) e contatore di quelle avviate: una taratura vale solo per una richiesta rimasta
// sola dall'inizio alla fine, perché il costo della sessione somma tutte le risposte
let inFlight = 0
let started = 0

// Fotografia all'inizio di una richiesta: serve a tararla alla risposta
export type StepMark = { seq: number; isAlone: boolean; costBefore: number | null }

// Prezzo base dalla risposta di una richiesta: aumento del costo diviso i token pesati con i rapporti di listino; null se la
// risposta non ha costo o token utili
export const priceFromStep = (deltaUsd: number, usage: ModelUsage, writeRatio: number) => {
  const weighted =
    usage.input_tokens +
    usage.cache_creation_input_tokens * writeRatio +
    usage.cache_read_input_tokens * CACHE_READ_RATIO +
    usage.output_tokens * OUTPUT_RATIO
  return deltaUsd > 0 && weighted > 0 ? deltaUsd / weighted : null
}

// Costo stimato di una ripresa: tutto il contesto riscritto in cache al prezzo di scrittura
export const resumeCost = (contextTokens: number, price: number, writeRatio: number) => contextTokens * price * writeRatio

// Prezzo base noto per un modello; senza, quello dell'ultimo modello tarato (stesso processo o sessione precedente)
export const priceFor = (model: string | null) =>
  (model ? prices.get(model) : undefined) ?? (lastModel ? prices.get(lastModel) : undefined) ?? null

// Carica da $.store l'ultimo modello tarato e il suo prezzo, e quello del modello in uso
export async function loadPrices($: EngineInterface, model: string | null) {
  try {
    const last = await $.store.get(LAST_KEY)
    if (typeof last === 'string' && last) {
      lastModel ??= last
    }
    for (const name of new Set([lastModel, model])) {
      if (name && !prices.has(name)) {
        const price = await $.store.get(priceKey(name))
        if (typeof price === 'number' && price > 0) {
          prices.set(name, price)
        }
      }
    }
  } catch {
    // store non disponibile: il prezzo arriva con la prima risposta
  }
}

// Inizio di una richiesta al modello (di ogni loop): la conta e, per il loop principale, prende il costo della sessione
export async function markStep($: EngineInterface, isMain: boolean): Promise<StepMark> {
  inFlight++
  started++
  const mark: StepMark = { seq: started, isAlone: inFlight === 1, costBefore: null }
  if (isMain && mark.isAlone) {
    try {
      mark.costBefore = (await $.session.usage()).cost?.usd ?? null
    } catch {
      // costo non disponibile: questa richiesta non tara
    }
  }
  return mark
}

// Fine di una richiesta: se è rimasta sola, tara il prezzo base del suo modello e lo salva in $.store se cambia
export async function settleStep(
  $: EngineInterface,
  mark: StepMark,
  model: string,
  usage: ModelUsage | null | undefined,
  writeRatio: number,
) {
  inFlight = Math.max(inFlight - 1, 0)
  if (!mark.isAlone || mark.seq !== started || mark.costBefore === null || !usage) {
    return
  }
  try {
    const costAfter = (await $.session.usage()).cost?.usd
    if (costAfter === undefined) {
      return
    }
    const measured = priceFromStep(costAfter - mark.costBefore, usage, writeRatio)
    if (measured === null) {
      return
    }
    const previous = prices.get(model)
    const price = previous === undefined ? measured : previous * (1 - PRICE_SMOOTHING) + measured * PRICE_SMOOTHING
    prices.set(model, price)
    const isNewModel = lastModel !== model
    lastModel = model
    if (previous === undefined || Math.abs(price - previous) / previous > PRICE_WRITE_DELTA) {
      await $.store.set(priceKey(model), price)
    }
    if (isNewModel) {
      await $.store.set(LAST_KEY, model)
    }
  } catch {
    // costo o store non disponibili: resta il prezzo di prima
  }
}
