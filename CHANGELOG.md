# Changelog

Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/).

## [0.5.1] - 2026-10-13

### Corretto
- L'effort non compariva in una sessione reale: oltre a `turn.step`, ora si legge anche dall'evento classico `Stop`, che a fine turno porta l'effort applicato (`effort.level`). I turni dei subagenti non lo cambiano.

### Modificato
- L'illustrazione `docs/usage-band.png` mostra la versione 0.5.1.

![La barra sopra il prompt, con uso normale e vicino ai limiti](docs/usage-band.png)

## [0.5.0] - 2026-10-13

### Aggiunto
- Dopo il modello compare l'effort in uso (`effort high`, in viola), prima dell'email. Si legge dalle richieste del loop principale (evento `turn.step`), quindi è noto dopo il primo prompt e non cambia per le richieste dei subagenti. Con un modello senza effort la voce non compare.

### Modificato
- L'illustrazione `docs/usage-band.png` mostra l'effort e la versione 0.5.0.

![La barra sopra il prompt, con uso normale e vicino ai limiti](docs/usage-band.png)

## [0.4.0] - 2026-10-13

### Modificato
- In fondo alla barra la versione mostrata è quella del mod (`usage-band v0.4.0`, letta dal suo `plugin.json`) al posto di quella di Claude Code.
- L'email dell'account si ricava all'avvio con `claude auth status`, senza bloccare l'avvio; il blocco `userEmail` del contesto resta come ripiego. Non si forza più il ricalcolo del contesto.
- L'illustrazione `docs/usage-band.png` mostra la versione del mod.

![La barra sopra il prompt, con uso normale e vicino ai limiti](docs/usage-band.png)

## [0.3.0] - 2026-10-13

### Aggiunto
- In fondo alla barra compaiono il modello in uso (arancio), l'email dell'account (azzurra) e la versione di Claude Code (verde acqua).
- Layout adattivo: su un terminale stretto la barra va su due righe, consumi sopra e ambiente sotto, così la coda non viene tagliata.
- L'email si legge dal blocco `userEmail` del contesto del primo messaggio; all'avvio del mod il contesto viene fatto ricalcolare perché l'email compaia anche a sessione già avviata.

### Modificato
- L'illustrazione `docs/usage-band.png` mostra le due righe con modello, email di esempio e versione.

![La barra sopra il prompt, con uso normale e vicino ai limiti](docs/usage-band.png)

## [0.2.0] - 2026-10-13

### Modificato
- La barra è sempre visibile, anche prima del primo dato: le voci senza dato mostrano `n/d`.
- Ogni nuova sessione parte con la barra visibile; `/usage-band` la nasconde solo per la sessione corrente.

### Aggiunto
- In coda alla barra compare la cartella di lavoro con la sua cartella padre (per esempio `projects\usage-band`), in giallo.
- Immagine di esempio in `docs/usage-band.png`: è un'illustrazione con valori di esempio, non uno screenshot.

![La barra sopra il prompt, con uso normale e vicino ai limiti](docs/usage-band.png)

### Corretto
- Spazio tra il simbolo di reset e l'orario o il giorno (`↻ 14:30`, `↻ lun 09:00`).

## [0.1.0] - 2026-10-13

### Aggiunto
- Barra sopra il prompt con percentuale del limite 5h, del limite settimanale e del contesto.
- Colori per soglia (verde, giallo, rosso) e orario di reset per i due limiti.
- Comando `/usage-band` per nascondere e rimostrare la barra.
- Test con `claude plugin test` e marketplace `mavida-mods` per l'installazione con `/plugin install`.
