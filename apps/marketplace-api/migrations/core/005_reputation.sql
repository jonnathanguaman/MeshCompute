-- M6: idempotencia de reputacion (doc 00 §15, doc B §23) y wallet del consumidor.
ALTER TABLE jobs ADD COLUMN reputation_applied_at TEXT;
ALTER TABLE jobs ADD COLUMN consumer_wallet TEXT;
