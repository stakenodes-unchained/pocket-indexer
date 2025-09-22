-- Migration 010: Augment schema to store full application/supplier/gateway data
-- This adds stake denoms, delegation tracking, unstake heights, and full service configs

-- Applications: add missing fields
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS stake_denom TEXT,
  ADD COLUMN IF NOT EXISTS delegated BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS gateway_address TEXT,
  ADD COLUMN IF NOT EXISTS delegatee_gateway_addresses TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS unstake_session_end_height TEXT,
  ADD COLUMN IF NOT EXISTS pending_undelegations JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pending_transfer JSONB;

-- Suppliers: add stake denom and unstake height
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS stake_denom TEXT,
  ADD COLUMN IF NOT EXISTS unstake_session_end_height TEXT;

-- Gateways: add stake denom and unstake height
ALTER TABLE gateways
  ADD COLUMN IF NOT EXISTS stake_denom TEXT,
  ADD COLUMN IF NOT EXISTS unstake_session_end_height TEXT;

-- Application service configurations (store full config per service)
CREATE TABLE IF NOT EXISTS application_service_configs (
  id SERIAL PRIMARY KEY,
  application_address TEXT NOT NULL,
  chain TEXT NOT NULL,
  service_id TEXT NOT NULL,
  endpoints TEXT[] DEFAULT '{}',
  config_options JSONB DEFAULT '{}'::jsonb,
  last_seen TIMESTAMP,
  UNIQUE(application_address, chain, service_id)
);

CREATE INDEX IF NOT EXISTS idx_appsvc_app ON application_service_configs(application_address, chain);
CREATE INDEX IF NOT EXISTS idx_appsvc_service ON application_service_configs(service_id);

-- Supplier service configurations (mirror app service configs for suppliers)
CREATE TABLE IF NOT EXISTS supplier_service_configs (
  id SERIAL PRIMARY KEY,
  supplier_address TEXT NOT NULL,
  chain TEXT NOT NULL,
  service_id TEXT NOT NULL,
  endpoints TEXT[] DEFAULT '{}',
  config_options JSONB DEFAULT '{}'::jsonb,
  last_seen TIMESTAMP,
  UNIQUE(supplier_address, chain, service_id)
);

CREATE INDEX IF NOT EXISTS idx_supsrv_supplier ON supplier_service_configs(supplier_address, chain);
CREATE INDEX IF NOT EXISTS idx_supsrv_service ON supplier_service_configs(service_id);

-- Delegations history (application <-> gateway)
CREATE TABLE IF NOT EXISTS delegations (
  id SERIAL PRIMARY KEY,
  application_address TEXT NOT NULL,
  gateway_address TEXT NOT NULL,
  chain TEXT NOT NULL,
  is_active BOOLEAN NOT NULL,
  action TEXT NOT NULL, -- 'add' | 'remove'
  timestamp TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(application_address, gateway_address, chain, timestamp, action)
);

CREATE INDEX IF NOT EXISTS idx_delegations_active ON delegations(chain, application_address, is_active);

-- Optional: unique network service definitions table (if needed by future features)
CREATE TABLE IF NOT EXISTS network_services (
  id TEXT PRIMARY KEY, -- service_id
  name TEXT,
  description TEXT,
  compute_units_per_relay BIGINT,
  owner_address TEXT,
  last_seen TIMESTAMP
);


