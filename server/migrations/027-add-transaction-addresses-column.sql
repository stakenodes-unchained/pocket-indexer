-- Migration 027: Add addresses array column to transactions table for efficient address filtering
-- This replaces expensive JSONB searches with fast array containment queries

-- Add addresses TEXT[] column to store all addresses related to a transaction
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS addresses TEXT[];

-- Create GIN index on addresses for fast array containment queries (@> operator)
-- This enables efficient queries like: WHERE addresses @> ARRAY['address1']
CREATE INDEX IF NOT EXISTS idx_transactions_addresses ON transactions USING GIN (addresses);
-- Add comment to column for documentation
COMMENT ON COLUMN transactions.addresses IS 'Array of all addresses related to this transaction (sender, recipient, and all addresses from messages)';

