# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Cos'è

`usage-band` è un **mod/plugin di Claude Code** (non un progetto WordPress): disegna una barra sopra il prompt con 5h / 7g / ctx, cartella, modello, effort, email e versione del mod. Il codice è TypeScript/TSX eseguito dal motore di Claude Code (`claude-code` e `claude-code/testing` sono moduli forniti dal runtime, non da npm). Non c'è `package.json`, né build, né PHPCS: le regole WordPress del CLAUDE.md globale non si applicano. Restano valide lingua (commenti in italiano, codice in inglese) e Conventional Commits.

## Comandi

```
claude plugin validate .                 # valida manifest e struttura
claude plugin test .                     # esegue hooks/register.test.ts
claude --plugin-dir <percorso>/usage-band  # prova il mod in una sessione reale
npx -y -p typescript@5.6.3 tsc -p . --noEmit  # controllo dei tipi: deve dare zero errori
```

Il controllo dei tipi usa `tsconfig.json`, che estende `.claude-plugin/types/tsconfig.json`: quella cartella la genera il motore quando carica il mod (con `--plugin-dir` o dalla cartella del marketplace) ed è esclusa da git. `claude plugin test` non controlla i tipi.

Richiede Claude Code >= 2.1.275 da terminale. Per i test si può filtrare per nome con gli argomenti di `claude plugin test`.

## Architettura

- `hooks/hooks.json` dichiara solo il modulo `./register.tsx`; tutta la logica è in `hooks/register.tsx` (`export const register`), che registra handler con `on(evento, ...)`.
- Lo stato vive in `atom({ plugin: 'usage-band', key })`, letti con `read` e scritti con `update`. Il tipo di ogni atom è dichiarato in `types/index.d.ts` (`PluginState`): aggiungendo un atom va aggiunta anche la chiave lì (`plugin.json` lo referenzia con `"types"`).
- Flusso dei dati: `session.start` (registra `/usage-band`, prima misura, versione da `plugin.json`, email da `claude auth status` in background, con ripiego su `.claude.json`) → `session.measure` (aggiorna lo snapshot di 5h/7g/ctx) → `turn.step` (effort, ignorando i subagenti; `turn.step` segna anche l'ultima richiesta per il countdown della cache, la cui durata arriva dalle variabili d'ambiente, altrimenti 1h, e `scheduleCacheTick` ridisegna solo quando l'etichetta cambia) → `turn.start` (un prompt con testo del loop principale apre l'operazione), `agent.spawn` (mappa agente → operazione) e `addUsage` da `turn.step` (somma i token dell'ultima operazione e ne aggiorna il costo come differenza di `$.session.usage().cost.usd` dall'inizio del prompt; un'operazione si apre solo dopo un `prompt.submit` della persona) → `ui.render` sul componente `AbovePrompt` che compone la barra e, quando vede un id di sessione nuovo dopo il primo disegno (/clear, /resume, fork), riesegue `fill`.
- Voce ctx (`contextFor` in `ui.render`): vale la percentuale dal vivo di `$.session.usage()`, che dopo un rewind è già quella del punto scelto. Subito dopo una compattazione il motore non ha la percentuale fino alla risposta successiva. A barra ferma la stima `estimateContext` conta allora i messaggi con `usage({ breakdown: 'full' })` e la salva nell'atom `contextEstimate` con l'impronta dei messaggi (`messagesBasis`), così una seconda compattazione la rifà. La prima `session.measure` con la percentuale la azzera. Niente hook su `/compact` o `/rewind` per il contesto: la barra si ridisegna da sé dopo entrambi i comandi (provato dal vivo), mentre il rewind con doppio Esc non ridisegna e non ha eventi.
- Niente eventi `classic.*`, `prompt.context`, `session.compact` né `session.append`: un plugin gestito (`cc-plugin-sec-default`) li scavalca e il motore avvisa a ogni hook saltato. Usare solo eventi nativi e letture dirette.
- Il rendering è una riga sola se `USAGE_ROW_WIDTH + 3 + lunghezza ambiente <= viewport.columns`, altrimenti due righe. Se si aggiunge una voce alla riga ambiente, va inclusa anche nel calcolo `envLength`.
- I colori usano le chiavi del tema (`success`/`warning`/`error`, ecc.), mai valori fissi.

## Release

Ogni versione tocca due posti coerenti: `version` in `.claude-plugin/plugin.json` (la barra legge da qui la versione mostrata) e una voce in `CHANGELOG.md` (in italiano, Keep a Changelog). L'illustrazione `docs/usage-band.png` si aggiorna solo quando cambia l'aspetto della barra, non a ogni versione. I commit seguono il formato `Versione X.Y.Z: descrizione`. `.claude-plugin/marketplace.json` pubblica il plugin come `mavida-mods`.
