-- JWT Sessions table for managing refresh tokens
-- This table stores hashed refresh tokens for JWT-based authentication
-- allowing users to maintain sessions across multiple devices

CREATE TABLE IF NOT EXISTS jwt_sessions (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES api_accounts(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL, -- SHA-256 hash of refresh token
    user_agent TEXT,
    ip_address VARCHAR(45), -- IPv4 or IPv6
    created_at TIMESTAMP DEFAULT NOW(),
    last_used_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP, -- NULL means active, non-NULL means revoked
    UNIQUE(token_hash)
);

-- Index for fast lookup by token hash
CREATE INDEX IF NOT EXISTS idx_jwt_sessions_token_hash ON jwt_sessions(token_hash);

-- Index for finding active sessions by account
CREATE INDEX IF NOT EXISTS idx_jwt_sessions_account_active ON jwt_sessions(account_id, revoked_at)
WHERE revoked_at IS NULL;

-- Index for cleanup of expired sessions
CREATE INDEX IF NOT EXISTS idx_jwt_sessions_expires_at ON jwt_sessions(expires_at);

-- Add comment
COMMENT ON TABLE jwt_sessions IS 'Stores refresh tokens for JWT-based user authentication';
COMMENT ON COLUMN jwt_sessions.token_hash IS 'SHA-256 hash of the refresh token for secure storage';
COMMENT ON COLUMN jwt_sessions.revoked_at IS 'Timestamp when session was revoked (logout). NULL = active session';
