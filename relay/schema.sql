-- SAI push relay schema (D1 / SQLite).
-- Stores no chat content: only opaque ids, the APNs device token, the APNs
-- environment, SHA-256 hashes of bearer secrets and timestamps.

CREATE TABLE IF NOT EXISTS registrations (
  push_id     TEXT PRIMARY KEY,          -- random 16 bytes, base64url
  owner_hash  TEXT NOT NULL,             -- hex SHA-256 of the phone's ownerToken
  apns_token  TEXT NOT NULL,             -- APNs device token (hex)
  env         TEXT NOT NULL CHECK (env IN ('sandbox', 'production')),
  created_at  INTEGER NOT NULL,          -- unix ms
  updated_at  INTEGER NOT NULL           -- unix ms
);

CREATE TABLE IF NOT EXISTS send_secrets (
  secret_id   TEXT PRIMARY KEY,          -- random 16 bytes, base64url
  push_id     TEXT NOT NULL REFERENCES registrations(push_id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL,             -- hex SHA-256 of the desktop's sendSecret
  label       TEXT NOT NULL,             -- legacy, always '' (no machine names are kept)
  created_at  INTEGER NOT NULL           -- unix ms
);

CREATE INDEX IF NOT EXISTS send_secrets_push_id ON send_secrets(push_id);
