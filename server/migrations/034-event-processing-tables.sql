-- Migration 034: Event processing tables for comprehensive event tracking
-- Creates tables for all event types as specified in POCKET_NETWORK_EVENT_PROCESSING.md

-- Claim Settlements
CREATE TABLE IF NOT EXISTS claim_settlements (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL,
    supplier_operator_address VARCHAR(255) NOT NULL,
    application_address VARCHAR(255) NOT NULL,
    service_id VARCHAR(255) NOT NULL,
    session_end_block_height BIGINT NOT NULL,
    settlement_type VARCHAR(20) NOT NULL,  -- 'settled', 'expired', 'discarded'
    expiration_reason VARCHAR(50),
    proof_requirement_int INTEGER,
    num_relays BIGINT NOT NULL,
    num_claimed_compute_units BIGINT NOT NULL,
    num_estimated_compute_units BIGINT NOT NULL,
    claimed_upokt BIGINT NOT NULL,
    claim_proof_status_int INTEGER,
    error_message TEXT,
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(session_id, supplier_operator_address)
);

-- Supplier Slashes
CREATE TABLE IF NOT EXISTS supplier_slashes (
    id SERIAL PRIMARY KEY,
    supplier_operator_address VARCHAR(255) NOT NULL,
    service_id VARCHAR(255) NOT NULL,
    application_address VARCHAR(255) NOT NULL,
    session_end_block_height BIGINT NOT NULL,
    proof_missing_penalty BIGINT NOT NULL,
    claim_proof_status_int INTEGER,
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Application Overservicing
CREATE TABLE IF NOT EXISTS application_overservicing (
    id SERIAL PRIMARY KEY,
    application_addr VARCHAR(255) NOT NULL,
    supplier_operator_addr VARCHAR(255) NOT NULL,
    expected_burn BIGINT NOT NULL,
    effective_burn BIGINT NOT NULL,
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Reward Distributions
CREATE TABLE IF NOT EXISTS reward_distributions (
    id SERIAL PRIMARY KEY,
    claim_settlement_id INTEGER REFERENCES claim_settlements(id) ON DELETE CASCADE,
    recipient_address VARCHAR(255) NOT NULL,
    amount BIGINT NOT NULL,  -- uPOKT amount
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Entity Lifecycle Events
CREATE TABLE IF NOT EXISTS entity_lifecycle_events (
    id SERIAL PRIMARY KEY,
    entity_type VARCHAR(20) NOT NULL,  -- 'application', 'supplier', 'gateway'
    entity_address VARCHAR(255) NOT NULL,
    event_type VARCHAR(50) NOT NULL,  -- 'staked', 'unbonding_begin', etc.
    reason INTEGER,  -- Unbonding reason enum value
    session_end_height BIGINT,
    unbonding_end_height BIGINT,
    transfer_source_address VARCHAR(255),
    transfer_destination_address VARCHAR(255),
    transfer_end_height BIGINT,
    error_message TEXT,
    entity_data JSONB,  -- Full entity object at time of event
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Proof Events (extends proof_submissions)
CREATE TABLE IF NOT EXISTS proof_events (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL,
    supplier_operator_address VARCHAR(255) NOT NULL,
    event_type VARCHAR(30) NOT NULL,  -- 'created', 'updated', 'submitted', 'validated'
    num_relays BIGINT,
    num_claimed_compute_units BIGINT,
    num_estimated_compute_units BIGINT,
    claimed_upokt BIGINT,
    service_id VARCHAR(255),
    application_address VARCHAR(255),
    session_end_block_height BIGINT,
    claim_proof_status_int INTEGER,
    failure_reason TEXT,
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Service Config Events
CREATE TABLE IF NOT EXISTS service_config_events (
    id SERIAL PRIMARY KEY,
    supplier_operator_address VARCHAR(255) NOT NULL,
    service_id VARCHAR(255) NOT NULL,
    activation_height BIGINT NOT NULL,
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Relay Mining Difficulty
CREATE TABLE IF NOT EXISTS relay_mining_difficulty (
    id SERIAL PRIMARY KEY,
    service_id VARCHAR(255) NOT NULL,
    prev_target_hash_hex_encoded VARCHAR(255),
    new_target_hash_hex_encoded VARCHAR(255) NOT NULL,
    prev_num_relays_ema BIGINT,
    new_num_relays_ema BIGINT NOT NULL,
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Migration Events
CREATE TABLE IF NOT EXISTS migration_events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    morse_src_address VARCHAR(255),
    shannon_dest_address VARCHAR(255),
    morse_node_address VARCHAR(255),
    morse_output_address VARCHAR(255),
    claim_signer_type INTEGER,
    claimed_balance BIGINT,
    claimed_application_stake BIGINT,
    claimed_supplier_stake BIGINT,
    recovered_balance BIGINT,
    morse_account_state_hash BYTEA,
    num_accounts INTEGER,
    created_at_height BIGINT,
    session_end_height BIGINT,
    entity_data JSONB,  -- Application or Supplier object if applicable
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Event Processing Status (for backfilling tracking)
CREATE TABLE IF NOT EXISTS event_processing_status (
    id SERIAL PRIMARY KEY,
    start_height BIGINT NOT NULL,
    end_height BIGINT NOT NULL,
    current_height BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL,  -- 'pending', 'processing', 'completed', 'failed'
    events_processed BIGINT DEFAULT 0,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT,
    created_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for claim settlements
CREATE INDEX IF NOT EXISTS idx_claim_settlements_session ON claim_settlements(session_id);
CREATE INDEX IF NOT EXISTS idx_claim_settlements_supplier ON claim_settlements(supplier_operator_address);
CREATE INDEX IF NOT EXISTS idx_claim_settlements_application ON claim_settlements(application_address);
CREATE INDEX IF NOT EXISTS idx_claim_settlements_height ON claim_settlements(block_height);
CREATE INDEX IF NOT EXISTS idx_claim_settlements_type ON claim_settlements(settlement_type);

-- Indexes for supplier slashes
CREATE INDEX IF NOT EXISTS idx_supplier_slashes_supplier ON supplier_slashes(supplier_operator_address);
CREATE INDEX IF NOT EXISTS idx_supplier_slashes_height ON supplier_slashes(block_height);

-- Indexes for application overservicing
CREATE INDEX IF NOT EXISTS idx_application_overservicing_app ON application_overservicing(application_addr);
CREATE INDEX IF NOT EXISTS idx_application_overservicing_height ON application_overservicing(block_height);

-- Indexes for reward distributions
CREATE INDEX IF NOT EXISTS idx_reward_distributions_recipient ON reward_distributions(recipient_address);
CREATE INDEX IF NOT EXISTS idx_reward_distributions_settlement ON reward_distributions(claim_settlement_id);
CREATE INDEX IF NOT EXISTS idx_reward_distributions_height ON reward_distributions(block_height);

-- Indexes for entity lifecycle events
CREATE INDEX IF NOT EXISTS idx_entity_lifecycle_type ON entity_lifecycle_events(entity_type, entity_address);
CREATE INDEX IF NOT EXISTS idx_entity_lifecycle_height ON entity_lifecycle_events(block_height);
CREATE INDEX IF NOT EXISTS idx_entity_lifecycle_event_type ON entity_lifecycle_events(event_type);

-- Indexes for proof events
CREATE INDEX IF NOT EXISTS idx_proof_events_session ON proof_events(session_id);
CREATE INDEX IF NOT EXISTS idx_proof_events_supplier ON proof_events(supplier_operator_address);
CREATE INDEX IF NOT EXISTS idx_proof_events_height ON proof_events(block_height);

-- Indexes for service config events
CREATE INDEX IF NOT EXISTS idx_service_config_supplier ON service_config_events(supplier_operator_address);
CREATE INDEX IF NOT EXISTS idx_service_config_service ON service_config_events(service_id);
CREATE INDEX IF NOT EXISTS idx_service_config_height ON service_config_events(block_height);

-- Indexes for relay mining difficulty
CREATE INDEX IF NOT EXISTS idx_relay_mining_service ON relay_mining_difficulty(service_id);
CREATE INDEX IF NOT EXISTS idx_relay_mining_height ON relay_mining_difficulty(block_height);

-- Indexes for migration events
CREATE INDEX IF NOT EXISTS idx_migration_events_type ON migration_events(event_type);
CREATE INDEX IF NOT EXISTS idx_migration_events_morse ON migration_events(morse_src_address);
CREATE INDEX IF NOT EXISTS idx_migration_events_height ON migration_events(block_height);

-- Indexes for event processing status
CREATE INDEX IF NOT EXISTS idx_event_processing_status ON event_processing_status(status, current_height);

