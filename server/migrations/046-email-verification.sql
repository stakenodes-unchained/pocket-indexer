-- Migration: Add email verification functionality
-- Description: Adds email verification code and tracking to api_accounts table
-- Date: 2026-01-11

-- Add email verification columns to api_accounts table
ALTER TABLE api_accounts
  ADD COLUMN IF NOT EXISTS email_verification_code VARCHAR(6),
  ADD COLUMN IF NOT EXISTS email_verification_code_expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS email_verification_attempts INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP WITH TIME ZONE;

-- Create index on verification code for faster lookups
CREATE INDEX IF NOT EXISTS idx_api_accounts_verification_code
  ON api_accounts(email_verification_code)
  WHERE email_verification_code IS NOT NULL;

-- Create index on email_verified for faster filtering
CREATE INDEX IF NOT EXISTS idx_api_accounts_email_verified
  ON api_accounts(email_verified);

-- Add comment to email_verified column for clarity
COMMENT ON COLUMN api_accounts.email_verified IS 'Boolean flag indicating if email address has been verified';
COMMENT ON COLUMN api_accounts.email_verification_code IS '6-digit verification code sent to email';
COMMENT ON COLUMN api_accounts.email_verification_code_expires_at IS 'Expiration timestamp for verification code (typically 1 hour from creation)';
COMMENT ON COLUMN api_accounts.email_verification_attempts IS 'Number of failed verification attempts (for rate limiting)';
COMMENT ON COLUMN api_accounts.email_verified_at IS 'Timestamp when email was successfully verified';

-- For existing accounts, set email_verified to true (backward compatibility)
UPDATE api_accounts
SET email_verified = true,
    email_verified_at = created_at
WHERE email_verified IS NULL OR email_verified = false;

-- Add constraint: verification code must be 6 digits if present (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_verification_code_format'
  ) THEN
    ALTER TABLE api_accounts
      ADD CONSTRAINT chk_verification_code_format
      CHECK (email_verification_code IS NULL OR email_verification_code ~ '^[0-9]{6}$');
  END IF;
END $$;

-- Add constraint: verification attempts cannot be negative (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_verification_attempts_positive'
  ) THEN
    ALTER TABLE api_accounts
      ADD CONSTRAINT chk_verification_attempts_positive
      CHECK (email_verification_attempts >= 0);
  END IF;
END $$;
