-- Migration 029: Add block_data JSONB column to store complete block API response

-- Add block_data column to store the complete block JSON from RPC
ALTER TABLE blocks
  ADD COLUMN IF NOT EXISTS block_data JSONB;

-- Add GIN index on block_data for efficient JSONB queries
CREATE INDEX IF NOT EXISTS idx_blocks_block_data ON blocks USING GIN (block_data);

-- Add comment for documentation
COMMENT ON COLUMN blocks.block_data IS 'Complete block data from RPC API response stored as JSONB for efficient querying without additional RPC calls';

