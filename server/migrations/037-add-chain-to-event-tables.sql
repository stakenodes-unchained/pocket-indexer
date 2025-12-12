-- Migration 037: Add chain column to all event processing tables
-- This enables proper chain filtering for multi-chain indexer support

-- Add chain column to claim_settlements
ALTER TABLE claim_settlements ADD COLUMN IF NOT EXISTS chain TEXT;

-- Add chain column to supplier_slashes
ALTER TABLE supplier_slashes ADD COLUMN IF NOT EXISTS chain TEXT;

-- Add chain column to application_overservicing
ALTER TABLE application_overservicing ADD COLUMN IF NOT EXISTS chain TEXT;

-- Add chain column to reward_distributions
ALTER TABLE reward_distributions ADD COLUMN IF NOT EXISTS chain TEXT;

-- Add chain column to entity_lifecycle_events
ALTER TABLE entity_lifecycle_events ADD COLUMN IF NOT EXISTS chain TEXT;

-- Add chain column to proof_events
ALTER TABLE proof_events ADD COLUMN IF NOT EXISTS chain TEXT;

-- Add chain column to service_config_events
ALTER TABLE service_config_events ADD COLUMN IF NOT EXISTS chain TEXT;

-- Add chain column to relay_mining_difficulty
ALTER TABLE relay_mining_difficulty ADD COLUMN IF NOT EXISTS chain TEXT;

-- Add chain column to migration_events
ALTER TABLE migration_events ADD COLUMN IF NOT EXISTS chain TEXT;

-- Add chain column to event_processing_status
ALTER TABLE event_processing_status ADD COLUMN IF NOT EXISTS chain TEXT;

-- Priority indexes for claim_settlements (most queried table)
CREATE INDEX IF NOT EXISTS idx_claim_settlements_chain_created ON claim_settlements(chain, created_timestamp);
CREATE INDEX IF NOT EXISTS idx_claim_settlements_chain_type_created ON claim_settlements(chain, settlement_type, created_timestamp);
CREATE INDEX IF NOT EXISTS idx_claim_settlements_chain ON claim_settlements(chain);

-- Indexes for reward_distributions
CREATE INDEX IF NOT EXISTS idx_reward_distributions_chain_height ON reward_distributions(chain, block_height);
CREATE INDEX IF NOT EXISTS idx_reward_distributions_chain ON reward_distributions(chain);

-- Composite indexes for other tables (chain, block_height)
CREATE INDEX IF NOT EXISTS idx_supplier_slashes_chain_height ON supplier_slashes(chain, block_height);
CREATE INDEX IF NOT EXISTS idx_supplier_slashes_chain ON supplier_slashes(chain);

CREATE INDEX IF NOT EXISTS idx_application_overservicing_chain_height ON application_overservicing(chain, block_height);
CREATE INDEX IF NOT EXISTS idx_application_overservicing_chain ON application_overservicing(chain);

CREATE INDEX IF NOT EXISTS idx_entity_lifecycle_chain_height ON entity_lifecycle_events(chain, block_height);
CREATE INDEX IF NOT EXISTS idx_entity_lifecycle_chain ON entity_lifecycle_events(chain);

CREATE INDEX IF NOT EXISTS idx_proof_events_chain_height ON proof_events(chain, block_height);
CREATE INDEX IF NOT EXISTS idx_proof_events_chain ON proof_events(chain);

CREATE INDEX IF NOT EXISTS idx_service_config_chain_height ON service_config_events(chain, block_height);
CREATE INDEX IF NOT EXISTS idx_service_config_chain ON service_config_events(chain);

CREATE INDEX IF NOT EXISTS idx_relay_mining_chain_height ON relay_mining_difficulty(chain, block_height);
CREATE INDEX IF NOT EXISTS idx_relay_mining_chain ON relay_mining_difficulty(chain);

CREATE INDEX IF NOT EXISTS idx_migration_events_chain_height ON migration_events(chain, block_height);
CREATE INDEX IF NOT EXISTS idx_migration_events_chain ON migration_events(chain);

CREATE INDEX IF NOT EXISTS idx_event_processing_status_chain ON event_processing_status(chain);

-- Comments for documentation
COMMENT ON COLUMN claim_settlements.chain IS 'Chain identifier (e.g., "pokt-mainnet", "pokt-testnet")';
COMMENT ON COLUMN supplier_slashes.chain IS 'Chain identifier (e.g., "pokt-mainnet", "pokt-testnet")';
COMMENT ON COLUMN application_overservicing.chain IS 'Chain identifier (e.g., "pokt-mainnet", "pokt-testnet")';
COMMENT ON COLUMN reward_distributions.chain IS 'Chain identifier (e.g., "pokt-mainnet", "pokt-testnet")';
COMMENT ON COLUMN entity_lifecycle_events.chain IS 'Chain identifier (e.g., "pokt-mainnet", "pokt-testnet")';
COMMENT ON COLUMN proof_events.chain IS 'Chain identifier (e.g., "pokt-mainnet", "pokt-testnet")';
COMMENT ON COLUMN service_config_events.chain IS 'Chain identifier (e.g., "pokt-mainnet", "pokt-testnet")';
COMMENT ON COLUMN relay_mining_difficulty.chain IS 'Chain identifier (e.g., "pokt-mainnet", "pokt-testnet")';
COMMENT ON COLUMN migration_events.chain IS 'Chain identifier (e.g., "pokt-mainnet", "pokt-testnet")';
COMMENT ON COLUMN event_processing_status.chain IS 'Chain identifier (e.g., "pokt-mainnet", "pokt-testnet")';

