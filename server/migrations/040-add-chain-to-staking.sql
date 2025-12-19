-- Migration 040: Add chain column to staking table
-- This enables proper chain filtering for multi-chain indexer support

-- Add chain column to staking
ALTER TABLE staking ADD COLUMN IF NOT EXISTS chain TEXT;

-- Add index for chain filtering
CREATE INDEX IF NOT EXISTS idx_staking_chain ON staking(chain);
CREATE INDEX IF NOT EXISTS idx_staking_chain_timestamp ON staking(chain, timestamp);
CREATE INDEX IF NOT EXISTS idx_staking_chain_address ON staking(chain, address);

-- Comment for documentation
COMMENT ON COLUMN staking.chain IS 'Chain identifier (e.g., "pocket-mainnet", "pocket-testnet-beta")';

