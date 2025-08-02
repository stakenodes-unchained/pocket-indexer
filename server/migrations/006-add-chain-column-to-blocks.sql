-- Add chain column to blocks table
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS chain TEXT;

-- Remove the unique constraint from height column
ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_height_key;

-- Add composite unique constraint on chain and height
ALTER TABLE blocks ADD CONSTRAINT blocks_chain_height_key UNIQUE (chain, height);

-- Add index on chain column for better query performance
CREATE INDEX IF NOT EXISTS idx_blocks_chain ON blocks(chain);

-- Add composite index on chain and height for better performance
CREATE INDEX IF NOT EXISTS idx_blocks_chain_height ON blocks(chain, height);

-- Add index on timestamp for time-based queries
CREATE INDEX IF NOT EXISTS idx_blocks_timestamp ON blocks(timestamp);
