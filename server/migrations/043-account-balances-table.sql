-- Migration 043: Account balances table for tracking all account balances
-- Tracks balances for all addresses (regular accounts + entities) on the chain

CREATE TABLE IF NOT EXISTS account_balances (
    address TEXT NOT NULL,
    chain TEXT NOT NULL,
    balance BIGINT NOT NULL DEFAULT 0,
    updated_block_height BIGINT NOT NULL,
    updated_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (address, chain)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_account_balances_chain ON account_balances(chain);
CREATE INDEX IF NOT EXISTS idx_account_balances_chain_address ON account_balances(chain, address);
CREATE INDEX IF NOT EXISTS idx_account_balances_chain_height ON account_balances(chain, updated_block_height DESC);
CREATE INDEX IF NOT EXISTS idx_account_balances_chain_timestamp ON account_balances(chain, updated_timestamp DESC);

-- Comments for documentation
COMMENT ON TABLE account_balances IS 'Tracks current balance in uPOKT for all addresses (regular accounts + entities)';
COMMENT ON COLUMN account_balances.address IS 'Account address';
COMMENT ON COLUMN account_balances.chain IS 'Chain identifier (e.g., "pokt-mainnet", "pokt-testnet")';
COMMENT ON COLUMN account_balances.balance IS 'Current balance in uPOKT (micro POKT)';
COMMENT ON COLUMN account_balances.updated_block_height IS 'Block height when balance was last updated';
COMMENT ON COLUMN account_balances.updated_timestamp IS 'Timestamp when balance was last updated';

