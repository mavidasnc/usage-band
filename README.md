# usage-band

Mod per Claude Code che disegna una barra sopra il prompt con tre indicatori e la cartella di lavoro:

![La barra sopra il prompt, con uso normale e vicino ai limiti](docs/usage-band.png)

L'immagine è un'illustrazione con valori di esempio.

- **5h**: percentuale usata della finestra di limite a 5 ore, con orario di reset.
- **7g**: percentuale usata del limite settimanale, con giorno e orario di reset.
- **ctx**: percentuale di riempimento della finestra di contesto della conversazione.
- **cartella**: cartella di lavoro con la sua cartella padre, in giallo.

I colori seguono il tema: verde sotto il 70%, giallo tra 70% e 90%, rosso da 90%.
Una voce senza dato mostra `n/d`.
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
