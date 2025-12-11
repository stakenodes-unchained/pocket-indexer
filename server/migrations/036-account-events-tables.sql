-- Migration 036: Account events tables for tracking coin_spent, coin_received, transfer, message, mint, commission, and rewards events

-- Account Events table (for coin_spent, coin_received, message events)
CREATE TABLE IF NOT EXISTS account_events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL, -- 'coin_spent', 'coin_received', 'message'
    account_address VARCHAR(255) NOT NULL,
    amount BIGINT NOT NULL DEFAULT 0,
    mode VARCHAR(50), -- 'BeginBlock', 'EndBlock', etc.
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_events_event_type ON account_events(event_type);
CREATE INDEX IF NOT EXISTS idx_account_events_account_address ON account_events(account_address);
CREATE INDEX IF NOT EXISTS idx_account_events_block_height ON account_events(block_height DESC);
CREATE INDEX IF NOT EXISTS idx_account_events_transaction_hash ON account_events(transaction_hash);
CREATE INDEX IF NOT EXISTS idx_account_events_created_timestamp ON account_events(created_timestamp DESC);

-- Account Transfers table (for transfer events)
CREATE TABLE IF NOT EXISTS account_transfers (
    id SERIAL PRIMARY KEY,
    sender_address VARCHAR(255) NOT NULL,
    recipient_address VARCHAR(255) NOT NULL,
    amount BIGINT NOT NULL,
    mode VARCHAR(50), -- 'BeginBlock', 'EndBlock', etc.
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_transfers_sender ON account_transfers(sender_address);
CREATE INDEX IF NOT EXISTS idx_account_transfers_recipient ON account_transfers(recipient_address);
CREATE INDEX IF NOT EXISTS idx_account_transfers_block_height ON account_transfers(block_height DESC);
CREATE INDEX IF NOT EXISTS idx_account_transfers_transaction_hash ON account_transfers(transaction_hash);
CREATE INDEX IF NOT EXISTS idx_account_transfers_created_timestamp ON account_transfers(created_timestamp DESC);

-- Mint Events table (for mint events)
CREATE TABLE IF NOT EXISTS mint_events (
    id SERIAL PRIMARY KEY,
    amount BIGINT NOT NULL DEFAULT 0,
    bonded_ratio NUMERIC,
    inflation NUMERIC,
    annual_provisions BIGINT,
    mode VARCHAR(50), -- 'BeginBlock', 'EndBlock', etc.
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mint_events_block_height ON mint_events(block_height DESC);
CREATE INDEX IF NOT EXISTS idx_mint_events_created_timestamp ON mint_events(created_timestamp DESC);

-- Validator Events table (for commission and rewards events)
CREATE TABLE IF NOT EXISTS validator_events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL, -- 'commission', 'rewards'
    validator_address VARCHAR(255) NOT NULL,
    amount BIGINT NOT NULL DEFAULT 0,
    mode VARCHAR(50), -- 'BeginBlock', 'EndBlock', etc.
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_validator_events_event_type ON validator_events(event_type);
CREATE INDEX IF NOT EXISTS idx_validator_events_validator_address ON validator_events(validator_address);
CREATE INDEX IF NOT EXISTS idx_validator_events_block_height ON validator_events(block_height DESC);
CREATE INDEX IF NOT EXISTS idx_validator_events_transaction_hash ON validator_events(transaction_hash);
CREATE INDEX IF NOT EXISTS idx_validator_events_created_timestamp ON validator_events(created_timestamp DESC);

COMMENT ON TABLE account_events IS 'Tracks coin_spent, coin_received, and message events for account balance tracking';
COMMENT ON TABLE account_transfers IS 'Tracks transfer events between accounts';
COMMENT ON TABLE mint_events IS 'Tracks token minting events with inflation and bonded ratio data';
COMMENT ON TABLE validator_events IS 'Tracks commission and rewards events for validators';

