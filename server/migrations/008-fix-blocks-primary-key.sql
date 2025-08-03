-- Fix blocks table constraints to handle multiple chains properly
-- Instead of changing the primary key, we'll ensure proper unique constraints

-- Ensure the composite unique constraint on (chain, height) exists
-- Drop it first if it exists to avoid conflicts
ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_chain_height_key;
ALTER TABLE blocks ADD CONSTRAINT blocks_chain_height_key UNIQUE (chain, height);

-- Add index on id column for better query performance
CREATE INDEX IF NOT EXISTS idx_blocks_id ON blocks(id);

-- Add index on chain column for better query performance
CREATE INDEX IF NOT EXISTS idx_blocks_chain ON blocks(chain); 