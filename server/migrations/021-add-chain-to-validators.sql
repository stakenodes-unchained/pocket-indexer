-- Migration 021: Add chain column to validators table and update primary key

-- Step 1: Add chain column (nullable initially)
ALTER TABLE validators
  ADD COLUMN IF NOT EXISTS chain TEXT;

-- Step 2: Backfill existing rows with default chain value
-- Note: Assuming existing validators are from mainnet. If you have a different default, adjust this.
UPDATE validators 
SET chain = 'mainnet' 
WHERE chain IS NULL;

-- Step 3: Make chain NOT NULL now that all rows have values
ALTER TABLE validators
  ALTER COLUMN chain SET NOT NULL;

-- Step 4: Drop the old primary key constraint
ALTER TABLE validators
  DROP CONSTRAINT IF EXISTS validators_pkey;

-- Step 5: Add composite primary key (operator_address, chain)
ALTER TABLE validators
  ADD CONSTRAINT validators_pkey PRIMARY KEY (operator_address, chain);

-- Step 6: Add new indexes for chain-aware queries
CREATE INDEX IF NOT EXISTS idx_validators_chain ON validators(chain);
CREATE INDEX IF NOT EXISTS idx_validators_chain_domain ON validators(chain, website_domain);

-- Step 7: Update comments
COMMENT ON COLUMN validators.chain IS 'Chain name this validator was observed on';
COMMENT ON TABLE validators IS 'Cached validator metadata from staking API for domain filtering and enrichment, per chain';

