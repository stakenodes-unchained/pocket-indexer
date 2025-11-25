-- Migration 030: Add claim metrics columns to claims table
-- Add the same metrics fields that are in proof_submissions for consistency

ALTER TABLE claims ADD COLUMN IF NOT EXISTS claim_proof_status_int INTEGER;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS claimed_upokt TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS num_claimed_compute_units BIGINT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS num_estimated_compute_units BIGINT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS num_relays BIGINT;

-- Add computed columns for analysis (similar to proof_submissions)
ALTER TABLE claims ADD COLUMN IF NOT EXISTS claimed_upokt_amount NUMERIC GENERATED ALWAYS AS (
  CASE 
    WHEN claimed_upokt ~ '^[0-9]+upokt$' THEN 
      CAST(REGEXP_REPLACE(claimed_upokt, 'upokt$', '') AS NUMERIC)
    ELSE 0
  END
) STORED;

ALTER TABLE claims ADD COLUMN IF NOT EXISTS compute_unit_efficiency NUMERIC GENERATED ALWAYS AS (
  CASE 
    WHEN num_estimated_compute_units > 0 THEN 
      ROUND((num_claimed_compute_units::NUMERIC / num_estimated_compute_units::NUMERIC) * 100, 2)
    ELSE 0
  END
) STORED;

ALTER TABLE claims ADD COLUMN IF NOT EXISTS reward_per_relay NUMERIC GENERATED ALWAYS AS (
  CASE 
    WHEN num_relays > 0 THEN 
      ROUND(
        (CASE 
          WHEN claimed_upokt ~ '^[0-9]+upokt$' THEN 
            CAST(REGEXP_REPLACE(claimed_upokt, 'upokt$', '') AS NUMERIC)
          ELSE 0
        END) / num_relays::NUMERIC, 2
      )
    ELSE 0
  END
) STORED;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_claims_status_int ON claims(claim_proof_status_int);
CREATE INDEX IF NOT EXISTS idx_claims_compute_units ON claims(num_claimed_compute_units);
CREATE INDEX IF NOT EXISTS idx_claims_relays ON claims(num_relays);

COMMENT ON COLUMN claims.claim_proof_status_int IS 'Status of the claim proof (0 = success)';
COMMENT ON COLUMN claims.claimed_upokt IS 'Amount of upokt claimed (e.g., "1332061upokt")';
COMMENT ON COLUMN claims.num_claimed_compute_units IS 'Number of compute units claimed';
COMMENT ON COLUMN claims.num_estimated_compute_units IS 'Number of estimated compute units';
COMMENT ON COLUMN claims.num_relays IS 'Number of relays in the claim';



