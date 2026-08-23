-- Un usuario proveedor puede publicar varias maquinas: el indice deja de ser unico.
DROP INDEX providers_owner_idx;

CREATE INDEX providers_owner_idx
  ON providers(owner_user_id) WHERE owner_user_id IS NOT NULL;
