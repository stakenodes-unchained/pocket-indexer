-- Migration: Add password reset token support
-- Description: Adds fields for password reset functionality with secure token storage
-- Date: 2026-01-20

-- Add password reset token fields to api_accounts
ALTER TABLE api_accounts
  ADD COLUMN IF NOT EXISTS password_reset_token_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS password_reset_token_expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS password_reset_attempts INTEGER DEFAULT 0;

-- Create index on password reset token hash for fast lookups
CREATE INDEX IF NOT EXISTS idx_api_accounts_password_reset_token_hash
  ON api_accounts(password_reset_token_hash)
  WHERE password_reset_token_hash IS NOT NULL;

-- Create index on token expiration for cleanup queries
CREATE INDEX IF NOT EXISTS idx_api_accounts_password_reset_token_expires
  ON api_accounts(password_reset_token_expires_at)
  WHERE password_reset_token_expires_at IS NOT NULL;

-- Add constraint for positive reset attempts (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_password_reset_attempts_positive'
  ) THEN
    ALTER TABLE api_accounts
      ADD CONSTRAINT chk_password_reset_attempts_positive
      CHECK (password_reset_attempts >= 0);
  END IF;
END $$;

-- Add comments for clarity
COMMENT ON COLUMN api_accounts.password_reset_token_hash IS 'SHA-256 hash of password reset token sent via email link (64 hex chars)';
COMMENT ON COLUMN api_accounts.password_reset_token_expires_at IS 'Expiration timestamp for password reset token (typically 1 hour from creation)';
COMMENT ON COLUMN api_accounts.password_reset_attempts IS 'Number of password reset requests (for rate limiting)';

-- Add last_password_change tracking
ALTER TABLE api_accounts
  ADD COLUMN IF NOT EXISTS last_password_change TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN api_accounts.last_password_change IS 'Timestamp of the last password change';
