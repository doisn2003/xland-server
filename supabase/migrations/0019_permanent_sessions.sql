-- Allow permanent session expiry (expires_at >= created_at)
ALTER TABLE xland.auth_sessions DROP CONSTRAINT IF EXISTS auth_sessions_check;
ALTER TABLE xland.auth_sessions ADD CONSTRAINT auth_sessions_check CHECK (expires_at >= created_at);
