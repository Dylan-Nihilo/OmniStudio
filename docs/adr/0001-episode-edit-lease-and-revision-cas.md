# Use an Episode edit lease with Script revision CAS

Concurrent writing uses a 90-second SQLite lease per Episode, renewed every 20 seconds, plus a SHA-256 Script revision compare-and-swap on save. The lease gives a 10-person team a clear single-editor experience while the revision check prevents stale clients and background generation work from overwriting newer content; CRDT collaboration is deferred until observed same-document concurrency justifies its operational and product complexity.
