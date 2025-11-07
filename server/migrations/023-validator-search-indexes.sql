-- Migration 023: Add indexes for validator and service search optimization
-- Optimizes the /api/v1/validators/search endpoint for <500ms response times

-- ============================================================================
-- Validator Search Indexes
-- ============================================================================

-- Index for moniker search (case-insensitive partial match)
-- Uses trigram index for fast ILIKE queries
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram index for fast moniker search
CREATE INDEX IF NOT EXISTS idx_validators_moniker_trgm 
ON validators USING gin(moniker gin_trgm_ops);

-- Composite index for chain + moniker search
CREATE INDEX IF NOT EXISTS idx_validators_chain_moniker_trgm 
ON validators(chain) 
INCLUDE (moniker, operator_address, account_address);

-- Index for account address search (pokt1...)
CREATE INDEX IF NOT EXISTS idx_validators_account_address_search 
ON validators(account_address) 
INCLUDE (operator_address, moniker, chain);

-- Index for operator address search (poktvaloper1...)
CREATE INDEX IF NOT EXISTS idx_validators_operator_address_search 
ON validators(operator_address, chain) 
INCLUDE (account_address, moniker);

-- ============================================================================
-- Service Search Indexes
-- ============================================================================

-- Index for searching service endpoints (JSON-RPC URLs) in supplier_service_configs
-- Uses GIN index on endpoints array for fast array containment searches
CREATE INDEX IF NOT EXISTS idx_supplier_service_configs_endpoints_gin 
ON supplier_service_configs USING gin(endpoints);

-- Composite index for service_id + chain lookups
CREATE INDEX IF NOT EXISTS idx_supplier_service_configs_service_chain 
ON supplier_service_configs(service_id, chain) 
INCLUDE (supplier_address, endpoints);

-- Index for supplier_address lookups (needed for finding suppliers using a service)
CREATE INDEX IF NOT EXISTS idx_supplier_service_configs_supplier_chain 
ON supplier_service_configs(supplier_address, chain) 
INCLUDE (service_id, endpoints);

-- ============================================================================
-- Performance Endpoint Indexes (for multiple supplier addresses)
-- ============================================================================

-- Composite index for proof_submissions with supplier_operator_address filtering
-- Optimizes WHERE supplier_operator_address IN (...) queries
CREATE INDEX IF NOT EXISTS idx_proof_submissions_supplier_chain_timestamp 
ON proof_submissions(supplier_operator_address, chain, timestamp DESC) 
INCLUDE (num_relays, num_claimed_compute_units, num_estimated_compute_units, compute_unit_efficiency, reward_per_relay, application_address, service_id)
WHERE claim_proof_status_int = 0;

-- Index for owner_address filtering via suppliers join
CREATE INDEX IF NOT EXISTS idx_suppliers_address_chain_owner 
ON suppliers(address, chain) 
INCLUDE (owner_address);

-- ============================================================================
-- Update Statistics
-- ============================================================================

ANALYZE validators;
ANALYZE supplier_service_configs;
ANALYZE suppliers;
ANALYZE proof_submissions;

