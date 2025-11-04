-- Migration 022: Add account_address column to validators table for matching with proof_submissions
-- This allows joining poktvaloper addresses (validators) with pokt addresses (proof_submissions)

ALTER TABLE validators
  ADD COLUMN IF NOT EXISTS account_address TEXT;

CREATE INDEX IF NOT EXISTS idx_validators_account_address ON validators(account_address);
CREATE INDEX IF NOT EXISTS idx_validators_chain_account ON validators(chain, account_address);

COMMENT ON COLUMN validators.account_address IS 'Account address (pokt...) converted from operator_address (poktvaloper...) for joining with proof_submissions';

