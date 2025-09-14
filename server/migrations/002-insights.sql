ALTER TABLE transactions ADD COLUMN IF NOT EXISTS amount_denom TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fee_denom TEXT;
CREATE TABLE IF NOT EXISTS suppliers (
  address TEXT,
  chain TEXT,
  public_key TEXT,
  staked_amount NUMERIC,
  status TEXT,
  service_url TEXT,
  last_seen TIMESTAMP,
  geo TEXT,
  PRIMARY KEY (address, chain)
);

CREATE TABLE IF NOT EXISTS applications (
  address TEXT,
  chain TEXT,
  public_key TEXT,
  staked_amount NUMERIC,
  status TEXT,
  chains TEXT[],
  last_seen TIMESTAMP,
  PRIMARY KEY (address, chain)
);

CREATE TABLE IF NOT EXISTS staking (
  id SERIAL PRIMARY KEY,
  address TEXT,
  type TEXT, -- 'supplier' or 'application'
  amount NUMERIC,
  event TEXT, -- 'stake', 'unstake', 'slash', 'reward'
  timestamp TIMESTAMP
);

CREATE TABLE IF NOT EXISTS services (
  id SERIAL PRIMARY KEY,
  supplier_address TEXT,
  chain TEXT,
  service_url TEXT,
  status TEXT,
  last_checked TIMESTAMP
);

CREATE TABLE IF NOT EXISTS nodes (
  address TEXT,
  chain TEXT,
  public_key TEXT,
  staked_amount NUMERIC,
  status TEXT,
  geo TEXT,
  last_seen TIMESTAMP,
  service_url TEXT,
  PRIMARY KEY (address, chain)
);

CREATE TABLE IF NOT EXISTS gateways (
  address TEXT,
  chain TEXT,
  public_key TEXT,
  staked_amount NUMERIC,
  status TEXT,
  service_url TEXT,
  last_seen TIMESTAMP,
  geo TEXT,
  PRIMARY KEY (address, chain)
); 