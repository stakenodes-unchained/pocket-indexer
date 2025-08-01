-- Add tx_data column to transactions table to store full JSON transaction data
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tx_data JSONB;

-- Add index on tx_data for better query performance
CREATE INDEX IF NOT EXISTS idx_transactions_tx_data ON transactions USING GIN (tx_data);

-- Add index on type column for better filtering
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);

-- Add index on status column for better filtering
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);

-- Add index on chain column for better filtering
CREATE INDEX IF NOT EXISTS idx_transactions_chain ON transactions(chain);

-- Add index on timestamp column for better ordering and date-based queries
CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);

-- Add composite index on chain and timestamp for better performance on chain-specific queries
CREATE INDEX IF NOT EXISTS idx_transactions_chain_timestamp ON transactions(chain, timestamp);

-- Add index on hash column for faster lookups
CREATE INDEX IF NOT EXISTS idx_transactions_hash ON transactions(hash); 