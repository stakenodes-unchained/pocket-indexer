-- Migration 039: Update claim_settlements unique constraint to include block_height
-- This allows the same session to be settled at different block heights
-- while preventing duplicate settlements at the same block height

-- Drop the existing unique constraint (PostgreSQL auto-generates constraint names)
-- Try common auto-generated constraint names
ALTER TABLE claim_settlements DROP CONSTRAINT IF EXISTS claim_settlements_session_id_supplier_operator_address_key;
ALTER TABLE claim_settlements DROP CONSTRAINT IF EXISTS claim_settlements_session_id_supplier_operator_address_fkey;

-- Also try dropping by the constraint definition if the name is different
-- First, find and drop any unique constraint/index on (session_id, supplier_operator_address)
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    -- Find the constraint name
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'claim_settlements'::regclass
      AND contype = 'u'
      AND array_length(conkey, 1) = 2
      AND (
        -- Check if it's on session_id and supplier_operator_address
        (SELECT attname FROM pg_attribute WHERE attrelid = 'claim_settlements'::regclass AND attnum = conkey[1]) = 'session_id'
        AND
        (SELECT attname FROM pg_attribute WHERE attrelid = 'claim_settlements'::regclass AND attnum = conkey[2]) = 'supplier_operator_address'
      )
    LIMIT 1;
    
    -- Drop if found
    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE claim_settlements DROP CONSTRAINT IF EXISTS %I', constraint_name);
    END IF;
END $$;

-- Add new unique constraint that includes block_height
-- This allows multiple settlement records for the same session at different block heights
CREATE UNIQUE INDEX IF NOT EXISTS claim_settlements_session_supplier_height_unique 
  ON claim_settlements(session_id, supplier_operator_address, block_height);

COMMENT ON INDEX claim_settlements_session_supplier_height_unique IS 
  'Unique constraint ensuring one settlement record per session, supplier, and block height';

