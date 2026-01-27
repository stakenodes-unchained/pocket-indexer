-- Migration: Add account_type to distinguish between registration flows
-- Description: Adds account_type field to support two registration flows:
--   - 'api_only': Email-only registration, no password, no verification required
--   - 'full': Full registration with password, requires email verification
-- Date: 2026-01-20

-- Add account_type column
ALTER TABLE api_accounts
  ADD COLUMN IF NOT EXISTS account_type VARCHAR(20) DEFAULT 'full';

-- Set constraint for valid account types
ALTER TABLE api_accounts
  ADD CONSTRAINT chk_account_type CHECK (account_type IN ('api_only', 'full'));

-- Set default account_type for existing accounts based on whether they have a password
UPDATE api_accounts
  SET account_type = CASE
    WHEN password_hash IS NULL THEN 'api_only'
    ELSE 'full'
  END
  WHERE account_type IS NULL;

-- Create index on account_type for filtering
CREATE INDEX IF NOT EXISTS idx_api_accounts_account_type
  ON api_accounts(account_type);

-- Add comment for clarity
COMMENT ON COLUMN api_accounts.account_type IS 'Account registration type: api_only (email-only, instant access) or full (with password, requires verification)';

-- Make password_hash nullable (it's already nullable, but explicitly stating for clarity)
-- api_only accounts don't have passwords
ALTER TABLE api_accounts
  ALTER COLUMN password_hash DROP NOT NULL;
