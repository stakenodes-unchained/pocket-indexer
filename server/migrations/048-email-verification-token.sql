-- Migration: Replace OTP-based email verification with token-based verification
-- Description: Replaces 6-digit verification codes with secure verification tokens sent via email link
-- Date: 2026-01-20

-- Remove old OTP-based verification columns
ALTER TABLE api_accounts
  DROP COLUMN IF EXISTS email_verification_code,
  DROP COLUMN IF EXISTS email_verification_code_expires_at;

-- Remove legacy token columns from previous implementation (if they exist)
ALTER TABLE api_accounts
  DROP COLUMN IF EXISTS email_verification_token,
  DROP COLUMN IF EXISTS email_verification_expires_at;

-- Drop old constraint on verification code format (6 digits)
ALTER TABLE api_accounts
  DROP CONSTRAINT IF EXISTS chk_verification_code_format;

-- Drop old index on verification code
DROP INDEX IF EXISTS idx_api_accounts_verification_code;

-- Add new token-based verification column
-- Token will be stored as SHA-256 hash (64 hex characters)
ALTER TABLE api_accounts
  ADD COLUMN IF NOT EXISTS email_verification_token_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS email_verification_token_expires_at TIMESTAMP WITH TIME ZONE;

-- Create index on verification token hash for faster lookups
CREATE INDEX IF NOT EXISTS idx_api_accounts_verification_token_hash
  ON api_accounts(email_verification_token_hash)
  WHERE email_verification_token_hash IS NOT NULL;

-- Create index on token expiration for cleanup queries
CREATE INDEX IF NOT EXISTS idx_api_accounts_verification_token_expires
  ON api_accounts(email_verification_token_expires_at)
  WHERE email_verification_token_expires_at IS NOT NULL;

-- Add comments for clarity
COMMENT ON COLUMN api_accounts.email_verification_token_hash IS 'SHA-256 hash of verification token sent via email link (64 hex chars)';
COMMENT ON COLUMN api_accounts.email_verification_token_expires_at IS 'Expiration timestamp for verification token (typically 24 hours from creation)';

-- Rename email_verification_attempts to be more generic (used for rate limiting)
-- This column can track both code and link verification attempts
COMMENT ON COLUMN api_accounts.email_verification_attempts IS 'Number of verification email send attempts (for rate limiting)';
