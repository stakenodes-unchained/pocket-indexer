-- Migration 032: Add chain column to claims table for consistency with proof_submissions

ALTER TABLE claims ADD COLUMN IF NOT EXISTS chain TEXT;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_claims_chain ON claims(chain);
CREATE INDEX IF NOT EXISTS idx_claims_chain_timestamp ON claims(chain, timestamp DESC);

-- Update the unique constraint to include chain (if needed for multi-chain support)
-- Note: The existing unique constraint doesn't include chain, so we'll keep it as is
-- but add chain to indexes for filtering

COMMENT ON COLUMN claims.chain IS 'Chain identifier (e.g., "pocket-mainnet", "pocket-testnet")';

