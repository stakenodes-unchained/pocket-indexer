-- Migration 042: Add chain column to account event tables
-- This enables proper chain filtering for multi-chain indexer support

-- Add chain column to account_events
ALTER TABLE account_events ADD COLUMN IF NOT EXISTS chain TEXT;

-- Add chain column to account_transfers
ALTER TABLE account_transfers ADD COLUMN IF NOT EXISTS chain TEXT;

-- Add chain column to mint_events
ALTER TABLE mint_events ADD COLUMN IF NOT EXISTS chain TEXT;

-- Add chain column to validator_events
ALTER TABLE validator_events ADD COLUMN IF NOT EXISTS chain TEXT;

-- Indexes for account_events
CREATE INDEX IF NOT EXISTS idx_account_events_chain ON account_events(chain);
CREATE INDEX IF NOT EXISTS idx_account_events_chain_height ON account_events(chain, block_height DESC);

-- Indexes for account_transfers
CREATE INDEX IF NOT EXISTS idx_account_transfers_chain ON account_transfers(chain);
CREATE INDEX IF NOT EXISTS idx_account_transfers_chain_height ON account_transfers(chain, block_height DESC);

-- Indexes for mint_events
CREATE INDEX IF NOT EXISTS idx_mint_events_chain ON mint_events(chain);
CREATE INDEX IF NOT EXISTS idx_mint_events_chain_height ON mint_events(chain, block_height DESC);

-- Indexes for validator_events
CREATE INDEX IF NOT EXISTS idx_validator_events_chain ON validator_events(chain);
CREATE INDEX IF NOT EXISTS idx_validator_events_chain_height ON validator_events(chain, block_height DESC);

-- Comments for documentation
COMMENT ON COLUMN account_events.chain IS 'Chain identifier (e.g., "pokt-mainnet", "pokt-testnet")';
COMMENT ON COLUMN account_transfers.chain IS 'Chain identifier (e.g., "pokt-mainnet", "pokt-testnet")';
COMMENT ON COLUMN mint_events.chain IS 'Chain identifier (e.g., "pokt-mainnet", "pokt-testnet")';
COMMENT ON COLUMN validator_events.chain IS 'Chain identifier (e.g., "pokt-mainnet", "pokt-testnet")';

