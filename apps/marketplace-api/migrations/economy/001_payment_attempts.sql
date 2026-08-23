CREATE TABLE payment_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  provider_id TEXT NOT NULL,
  recipient_address TEXT NOT NULL,
  sender_address TEXT,
  token_address TEXT,
  amount_atomic TEXT NOT NULL,
  fee_atomic TEXT,
  chain_id INTEGER,
  mode TEXT NOT NULL CHECK (mode IN ('SIMULATED', 'WDK_TESTNET')),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SUBMITTED', 'PAID', 'FAILED')),
  tx_hash TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id),
  FOREIGN KEY(provider_id) REFERENCES providers(id)
);

CREATE INDEX payment_attempts_status_created_idx
  ON payment_attempts(status, created_at DESC);
