-- Migration 035: Extend claims table with settlement status fields
-- Adds fields to track claim settlement outcomes from events

-- Add settlement status field
ALTER TABLE claims ADD COLUMN IF NOT EXISTS settlement_status VARCHAR(20);
-- Values: 'pending', 'settled', 'expired', 'discarded'

-- Add settlement block height (when claim was settled/expired/discarded)
ALTER TABLE claims ADD COLUMN IF NOT EXISTS settlement_block_height BIGINT;

-- Add expiration reason (for expired claims)
ALTER TABLE claims ADD COLUMN IF NOT EXISTS expiration_reason VARCHAR(50);

-- Add error message (for discarded claims)
ALTER TABLE claims ADD COLUMN IF NOT EXISTS settlement_error_message TEXT;

-- Add proof requirement reason
ALTER TABLE claims ADD COLUMN IF NOT EXISTS proof_requirement_int INTEGER;

-- Add indexes for settlement queries
CREATE INDEX IF NOT EXISTS idx_claims_settlement_status ON claims(settlement_status);
CREATE INDEX IF NOT EXISTS idx_claims_settlement_height ON claims(settlement_block_height);

-- Add comment for documentation
COMMENT ON COLUMN claims.settlement_status IS 'Status of claim settlement: pending, settled, expired, or discarded';
COMMENT ON COLUMN claims.settlement_block_height IS 'Block height when claim was settled/expired/discarded';
COMMENT ON COLUMN claims.expiration_reason IS 'Reason for claim expiration (PROOF_MISSING, PROOF_INVALID)';
COMMENT ON COLUMN claims.settlement_error_message IS 'Error message for discarded claims';

