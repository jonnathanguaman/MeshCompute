ALTER TABLE jobs ADD COLUMN client_user_id TEXT REFERENCES users(id);

CREATE INDEX jobs_client_created_idx ON jobs(client_user_id, created_at DESC);
