# Da studiare

## Segno `(P)` per `opusplan`

Rimosso in 0.11.0: il mod non riesce a sapere se la sessione usa `opusplan`.

- `$.session.model()` dà solo il modello effettivo: con `--model opusplan` fuori da plan mode è `claude-sonnet-5-5`, indistinguibile da una sessione Sonnet.
- `session.start` non porta il modello scelto (solo `cwd`, `surface`, `isInteractive`).
- `classic.SessionStart` ha un campo `model`, ma non scatta all'avvio (verificato con un log temporaneo).
- `classic.PostModelSwitch.requested_model` dà l'alias, ma solo ai cambi (`/model`, picker, SDK, ripresa), non al flag `--model` di avvio.
- Leggere `settings.json` / `ANTHROPIC_MODEL` è inaffidabile: il flag `--model` ha la precedenza e il mod non lo vede.

Idee da valutare:
- inferenza dal comportamento: se nello stesso turno `stepModel` passa da Sonnet a Opus entrando in plan mode, è opusplan;
- controllare se nuove versioni di Claude Code espongono il modello richiesto all'avvio (campo in `session.start`, o `classic.SessionStart` all'avvio).
