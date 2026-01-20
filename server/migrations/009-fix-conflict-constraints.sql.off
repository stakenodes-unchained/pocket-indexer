-- Migration 009: Fix ON CONFLICT constraints for multi-chain support
-- This migration ensures all entity tables have proper composite primary keys
-- and fixes any ON CONFLICT issues

-- Drop and recreate suppliers table with proper constraints
-- DROP TABLE IF EXISTS suppliers CASCADE;
-- CREATE TABLE suppliers (
--   address TEXT NOT NULL,
--   chain TEXT NOT NULL,
--   public_key TEXT,
--   staked_amount NUMERIC DEFAULT 0,
--   status TEXT,
--   service_url TEXT,
--   last_seen TIMESTAMP,
--   geo TEXT,
--   PRIMARY KEY (address, chain)
-- );

-- Drop and recreate applications table with proper constraints
-- DROP TABLE IF EXISTS applications CASCADE;
-- CREATE TABLE applications (
--   address TEXT NOT NULL,
--   chain TEXT NOT NULL,
--   public_key TEXT,
--   staked_amount NUMERIC DEFAULT 0,
--   status TEXT,
--   chains TEXT[],
--   last_seen TIMESTAMP,
--   PRIMARY KEY (address, chain)
-- );

-- Drop and recreate nodes table with proper constraints
-- DROP TABLE IF EXISTS nodes CASCADE;
-- CREATE TABLE nodes (
--   address TEXT NOT NULL,
--   chain TEXT NOT NULL,
--   public_key TEXT,
--   staked_amount NUMERIC DEFAULT 0,
--   status TEXT,
--   geo TEXT,
--   last_seen TIMESTAMP,
--   service_url TEXT,
--   PRIMARY KEY (address, chain)
-- );

-- -- Drop and recreate gateways table with proper constraints
-- DROP TABLE IF EXISTS gateways CASCADE;
-- CREATE TABLE gateways (
--   address TEXT NOT NULL,
--   chain TEXT NOT NULL,
--   public_key TEXT,
--   staked_amount NUMERIC DEFAULT 0,
--   status TEXT,
--   service_url TEXT,
--   last_seen TIMESTAMP,
--   geo TEXT,
--   PRIMARY KEY (address, chain)
-- );

-- -- Ensure services table has proper constraints
-- -- Services table uses different structure (supplier_address + chain)
-- DROP TABLE IF EXISTS services CASCADE;
-- CREATE TABLE services (
--   id SERIAL PRIMARY KEY,
--   supplier_address TEXT NOT NULL,
--   chain TEXT NOT NULL,
--   service_url TEXT,
--   status TEXT,
--   last_checked TIMESTAMP,
--   UNIQUE(supplier_address, chain, service_url)
-- );

-- -- Ensure staking table has proper constraints
-- -- This table tracks staking events, not current state
-- DROP TABLE IF EXISTS staking CASCADE;
-- CREATE TABLE staking (
--   id SERIAL PRIMARY KEY,
--   address TEXT NOT NULL,
--   chain TEXT NOT NULL,
--   type TEXT NOT NULL, -- 'supplier', 'application', 'node', 'gateway'
--   amount NUMERIC,
--   event TEXT NOT NULL, -- 'stake', 'unstake', 'slash', 'reward'
--   timestamp TIMESTAMP NOT NULL,
--   created_at TIMESTAMP DEFAULT NOW()
-- );

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_suppliers_chain ON suppliers(chain);
CREATE INDEX IF NOT EXISTS idx_suppliers_status ON suppliers(status);
CREATE INDEX IF NOT EXISTS idx_suppliers_last_seen ON suppliers(last_seen);

CREATE INDEX IF NOT EXISTS idx_applications_chain ON applications(chain);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_last_seen ON applications(last_seen);

CREATE INDEX IF NOT EXISTS idx_nodes_chain ON nodes(chain);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_last_seen ON nodes(last_seen);

CREATE INDEX IF NOT EXISTS idx_gateways_chain ON gateways(chain);
CREATE INDEX IF NOT EXISTS idx_gateways_status ON gateways(status);
CREATE INDEX IF NOT EXISTS idx_gateways_last_seen ON gateways(last_seen);

CREATE INDEX IF NOT EXISTS idx_services_supplier ON services(supplier_address);
CREATE INDEX IF NOT EXISTS idx_services_chain ON services(chain);
CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);

CREATE INDEX IF NOT EXISTS idx_staking_address ON staking(address);
CREATE INDEX IF NOT EXISTS idx_staking_chain ON staking(chain);
CREATE INDEX IF NOT EXISTS idx_staking_type ON staking(type);
CREATE INDEX IF NOT EXISTS idx_staking_event ON staking(event);
CREATE INDEX IF NOT EXISTS idx_staking_timestamp ON staking(timestamp);

-- Add composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_staking_address_chain ON staking(address, chain);
CREATE INDEX IF NOT EXISTS idx_staking_type_event ON staking(type, event);
CREATE INDEX IF NOT EXISTS idx_staking_chain_timestamp ON staking(chain, timestamp);
