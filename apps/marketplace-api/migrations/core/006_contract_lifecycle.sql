-- Ciclo de vida completo del contrato: COMPLETED (job pagado) y EXPIRED (vencio
-- expires_at). SQLite no permite alterar el CHECK: se reconstruye la tabla.
ALTER TABLE contracts RENAME TO contracts_legacy;

CREATE TABLE contracts (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  client_user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (
    status IN ('REQUESTED', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'EXPIRED')
  ),
  price_per_1k_tokens_atomic TEXT NOT NULL,
  model_label TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Las filas legadas abiertas reciben una vigencia de 1 hora desde la migracion
-- para que tambien terminen; las cerradas quedan sin vencimiento.
INSERT INTO contracts (
  id, provider_id, client_user_id, status, price_per_1k_tokens_atomic,
  model_label, message, expires_at, created_at, updated_at
)
SELECT
  id, provider_id, client_user_id, status, price_per_1k_tokens_atomic,
  model_label, message,
  CASE
    WHEN status IN ('REQUESTED', 'ACCEPTED')
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour')
    ELSE NULL
  END,
  created_at, updated_at
FROM contracts_legacy;

DROP TABLE contracts_legacy;

CREATE INDEX contracts_provider_idx ON contracts(provider_id, created_at DESC);
CREATE INDEX contracts_client_idx ON contracts(client_user_id, created_at DESC);
