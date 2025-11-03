-- Migration 020: Add owner_address column to suppliers table
-- This enables filtering validators by owner address

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS owner_address TEXT;

-- Add index for owner address filtering
CREATE INDEX IF NOT EXISTS idx_suppliers_owner_address ON suppliers(owner_address);

COMMENT ON COLUMN suppliers.owner_address IS 'Owner address for the supplier (from MsgStakeSupplier.owner_address)';

