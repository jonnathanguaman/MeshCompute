CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('PROVIDER', 'CLIENT')),
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX sessions_user_idx ON sessions(user_id);

ALTER TABLE providers ADD COLUMN owner_user_id TEXT REFERENCES users(id);
ALTER TABLE providers ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE providers ADD COLUMN source TEXT NOT NULL DEFAULT 'AGENT'
  CHECK (source IN ('AGENT', 'PORTAL'));

CREATE UNIQUE INDEX providers_owner_idx
  ON providers(owner_user_id) WHERE owner_user_id IS NOT NULL;

CREATE TABLE contracts (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  client_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('REQUESTED', 'ACCEPTED', 'REJECTED', 'CANCELLED')),
  price_per_1k_tokens_atomic TEXT NOT NULL,
  model_label TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX contracts_provider_idx ON contracts(provider_id, created_at DESC);
CREATE INDEX contracts_client_idx ON contracts(client_user_id, created_at DESC);
