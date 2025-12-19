-- Migration 041: Drop old blocks_height_key constraint
-- The old unique constraint on height alone conflicts with multi-chain support
-- where the same height can exist for different chains
-- This constraint should have been removed in migration 006, but may still exist

-- Drop the old unique constraint on height alone if it exists
ALTER TABLE blocks DROP CONSTRAINT IF EXISTS blocks_height_key;

-- Ensure the composite unique constraint on (chain, height) exists
-- This allows the same height for different chains
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'blocks_chain_height_key' 
    AND conrelid = 'blocks'::regclass
  ) THEN
    ALTER TABLE blocks ADD CONSTRAINT blocks_chain_height_key UNIQUE (chain, height);
  END IF;
END $$;

