-- Migration 052: Add unique index for services upsert
-- Ensures ON CONFLICT (supplier_address, chain, service_url) has a matching unique constraint
-- Note: This will fail if duplicate rows already exist for the same (supplier_address, chain, service_url).

CREATE UNIQUE INDEX IF NOT EXISTS idx_services_supplier_chain_url
ON services (supplier_address, chain, service_url);

