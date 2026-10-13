# usage-band

Mod per Claude Code che disegna una barra sopra il prompt con tre indicatori:

```
5h ███████░░░ 68% ↻14:30 │ 7g ███░░░░░░░ 31% ↻lun 09:00 │ ctx █████░░░░░ 47%
```

- **5h**: percentuale usata della finestra di limite a 5 ore, con orario di reset.
- **7g**: percentuale usata del limite settimanale, con giorno e orario di reset.
- **ctx**: percentuale di riempimento della finestra di contesto della conversazione.

I colori seguono il tema: verde sotto il 70%, giallo tra 70% e 90%, rosso da 90%.
Una voce senza dato mostra `n/d`; senza alcun dato la barra non compare.
I limiti 5h e settimanale esistono solo con un abbonamento Claude (Pro, Max, Team).

## Comandi

- `/usage-band`: nasconde la barra, un secondo invio la rimostra.

## Installazione

Serve Claude Code 2.1.275 o successivo, da terminale (non nella tab Code dell'app desktop).
Il repository è privato: bisogna avere accesso a `mavidasnc` su GitHub e le credenziali git
configurate (per esempio con `gh auth login`).

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
