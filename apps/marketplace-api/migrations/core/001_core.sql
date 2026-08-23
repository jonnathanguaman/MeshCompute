CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  qvac_public_key TEXT NOT NULL UNIQUE,
  wallet_address TEXT NOT NULL,
  model_key TEXT NOT NULL,
  model_label TEXT NOT NULL,
  hardware_label TEXT NOT NULL,
  price_per_1k_tokens_atomic TEXT NOT NULL,
  pricing_mode TEXT NOT NULL DEFAULT 'PER_JOB' CHECK (pricing_mode = 'PER_JOB'),
  token_symbol TEXT NOT NULL DEFAULT 'mUSDT' CHECK (token_symbol = 'mUSDT'),
  status TEXT NOT NULL CHECK (status IN ('ONLINE', 'OFFLINE', 'BUSY')),
  reputation INTEGER NOT NULL DEFAULT 95 CHECK (reputation BETWEEN 0 AND 100),
  jobs_completed INTEGER NOT NULL DEFAULT 0,
  jobs_failed INTEGER NOT NULL DEFAULT 0,
  provider_token_hash TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX providers_status_reputation_idx
  ON providers(status, reputation DESC, price_per_1k_tokens_atomic ASC);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  provider_wallet_address TEXT NOT NULL,
  verifier_provider_id TEXT,
  model_key TEXT NOT NULL,
  prompt_hash TEXT NOT NULL CHECK (length(prompt_hash) = 64),
  output_hash TEXT CHECK (output_hash IS NULL OR length(output_hash) = 64),
  verifier_output_hash TEXT CHECK (verifier_output_hash IS NULL OR length(verifier_output_hash) = 64),
  input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  quoted_amount_atomic TEXT NOT NULL,
  settled_amount_atomic TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'CREATED', 'ASSIGNED', 'CONNECTING', 'RUNNING', 'VERIFYING', 'VERIFIED',
    'VERIFICATION_FAILED', 'PAYMENT_PENDING', 'PAID', 'PAYMENT_FAILED',
    'FAILED', 'CANCELLED'
  )),
  verification_status TEXT NOT NULL CHECK (verification_status IN (
    'NOT_REQUESTED', 'PENDING', 'PASSED', 'FAILED'
  )),
  payment_status TEXT NOT NULL CHECK (payment_status IN (
    'NOT_STARTED', 'PENDING', 'PAID', 'FAILED'
  )),
  payment_mode TEXT CHECK (payment_mode IS NULL OR payment_mode IN ('SIMULATED', 'WDK_TESTNET')),
  payment_tx_hash TEXT,
  payment_error_code TEXT,
  execution_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY(provider_id) REFERENCES providers(id),
  FOREIGN KEY(verifier_provider_id) REFERENCES providers(id)
);

CREATE INDEX jobs_provider_created_idx ON jobs(provider_id, created_at DESC);
CREATE INDEX jobs_status_created_idx ON jobs(status, created_at DESC);
