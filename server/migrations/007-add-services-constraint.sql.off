-- Add unique constraint on services table for supplier_address and chain
ALTER TABLE services ADD CONSTRAINT services_supplier_chain_key UNIQUE (supplier_address, chain);

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_services_supplier ON services(supplier_address);
CREATE INDEX IF NOT EXISTS idx_services_chain ON services(chain); 