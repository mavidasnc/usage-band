# usage-band

Mod per Claude Code che disegna una barra sopra il prompt con tre indicatori di consumo e alcune informazioni sull'ambiente:

![La barra sopra il prompt, con uso normale, vicino ai limiti e con i dettagli nascosti](docs/usage-band.png)

L'immagine è un'illustrazione con valori di esempio.

- **5h**: percentuale usata della finestra di limite a 5 ore, con orario di reset.
- **7g**: percentuale usata del limite settimanale, con giorno e orario di reset.
- **ctx**: percentuale di riempimento della finestra di contesto della conversazione.
  Un clic, a prompt vuoto, vi scrive (senza inviarla) la richiesta di valutare `/compact` con la percentuale attuale;
  se il prompt contiene già del testo non lo tocca e mostra un avviso.
- **cache**: tempo che resta prima che scada la cache del prompt, contato dall'ultima richiesta del thread principale:
  in minuti (`cache 42m`) sopra i 10 minuti, poi in minuti e secondi (`cache 9:58`), `cache scaduta` a zero.
  Verde, giallo sotto il 25% della durata, rosso sotto il 10% e quando è scaduta. La durata (5 minuti o 1 ora) viene da `FORCE_PROMPT_CACHING_5M` / `ENABLE_PROMPT_CACHING_1H`,
  altrimenti vale un'ora.
  Dopo `/resume` (o `claude --resume`) ctx e cache compaiono subito: la cache è contata dall'ultima risposta della conversazione ripresa,
  letta dal suo transcript.
- **tkn**: consumo dell'ultimo prompt, con tutte le richieste in cui si spezza e i subagenti che lancia.
  Compatto: token nuovi (ingresso e uscita) e costo (`tkn 28.7k · $0.54`). Un clic sulla voce passa al dettaglio
  (`tkn ↑27.8k ↓875 ♺ 939.6k 97% (∴37.6k) · $0.54`): ingresso, uscita, letti dalla cache con la quota di riuso,
  tra parentesi la parte dei subagenti (già compresa negli altri). Il costo è quello che calcola Claude Code
  (lo stesso di `/cost`, a prezzo di listino): con un abbonamento è indicativo, non una spesa.
- **costo della sessione**: subito a destra di `tkn`, solo il valore in dollari (`$12.30`), in rosa. È il costo dell'intera
  sessione come lo conta Claude Code (lo stesso di `/cost`): dopo `--continue` o `--resume` comprende anche il lavoro precedente,
  `/clear` lo azzera. Non è cliccabile e compare dalla prima richiesta.
- **cartella**: cartella di lavoro con la sua cartella padre, in giallo.
- **modello**: il nome leggibile del modello in uso (`Opus 5.5`, non `claude-opus-5-5`), in arancio;
  durante un turno mostra il modello della richiesta in corso (con `opusplan` in plan mode, ad esempio, `Opus 5.5`).
  Un clic esegue `/model`, senza toccare ciò che si sta scrivendo nel prompt.
- **effort**: l'effort in uso, solo il livello (`low`, `medium`, `high`, `xhigh`, `max`), in viola. Compare dopo il primo prompt
  (dalle richieste al modello) e solo per i modelli che hanno un effort. Un clic esegue `/effort`.
- **email**: l'account corrente, in azzurro, ricavata all'avvio con `claude auth status`
  (serve `claude` nel `PATH`; altrimenti viene dal file di configurazione di Claude Code, `.claude.json`).
- **versione**: versione del mod (`vX.Y.Z`), in verde acqua.

I colori seguono il tema: verde sotto il 70%, giallo tra 70% e 90%, rosso da 90%.
Una voce senza dato mostra `n/d`.
Se il terminale è abbastanza largo tutto sta su una riga, altrimenti i consumi restano
sulla prima riga e token, cartella, modello, email e versione vanno sulla seconda.
Subito dopo la cache, separato da una pipe, un pulsante (`[◂]`, cliccabile) nasconde token, cartella, modello, effort, email e versione
lasciando solo i consumi; `[▸]` li rimostra. La scelta vale per la sessione e resta dopo `/clear`.
La barra è sempre visibile e cede il posto solo ai sondaggi di Claude Code.
I limiti 5h e settimanale esistono solo con un abbonamento Claude (Pro, Max, Team).

## Comandi

- `/usage-band`: nasconde la barra per la sessione corrente, un secondo invio la rimostra.
  Ogni nuova sessione riparte con la barra visibile.

## Installazione

Serve Claude Code 2.1.275 o successivo, da terminale (non nella tab Code dell'app desktop).

```
/plugin install usage-band --marketplace mavidasnc/usage-band
```

Confermare con `y` l'aggiunta del marketplace e scegliere lo scope `user` per averla in ogni progetto.

## Aggiornamento

Da `/plugin`, sezione dei marketplace, aggiornare `mavida-mods` e poi il plugin `usage-band`.

## Sviluppo

```
claude plugin validate .
claude plugin test .
claude --plugin-dir <percorso>/usage-band
```

La struttura segue le convenzioni dei mod: `hooks/register.tsx` contiene la logica,
`types/index.d.ts` il contratto dello stato, `hooks/register.test.ts` i test.
Le modifiche sono elencate in [CHANGELOG.md](CHANGELOG.md).
