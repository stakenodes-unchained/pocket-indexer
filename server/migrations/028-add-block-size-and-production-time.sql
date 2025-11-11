-- Migration 028: Add raw block size and block production time to blocks table

-- Add raw_block_size column (size in bytes of the serialized block)
ALTER TABLE blocks
  ADD COLUMN IF NOT EXISTS raw_block_size BIGINT;

-- Add block_production_time column (time in seconds it took to produce the block)
-- This is calculated as the difference between current block time and previous block time
ALTER TABLE blocks
  ADD COLUMN IF NOT EXISTS block_production_time NUMERIC(10, 3);

-- Add index for raw_block_size for analytics queries
CREATE INDEX IF NOT EXISTS idx_blocks_raw_block_size ON blocks(raw_block_size);

-- Add index for block_production_time for analytics queries
CREATE INDEX IF NOT EXISTS idx_blocks_production_time ON blocks(block_production_time);

-- Add comment for documentation
COMMENT ON COLUMN blocks.raw_block_size IS 'Raw block size in bytes (serialized block size as received over the wire)';
COMMENT ON COLUMN blocks.block_production_time IS 'Block production time in seconds (time difference between current and previous block)';

