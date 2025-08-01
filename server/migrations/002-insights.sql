CREATE TABLE IF NOT EXISTS suppliers (
  address TEXT PRIMARY KEY,
  public_key TEXT,
  staked_amount NUMERIC,
  status TEXT,
  service_url TEXT,
  last_seen TIMESTAMP,
  geo TEXT
);

CREATE TABLE IF NOT EXISTS applications (
  address TEXT PRIMARY KEY,
  public_key TEXT,
  staked_amount NUMERIC,
  status TEXT,
  chains TEXT[],
  last_seen TIMESTAMP
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
  address TEXT PRIMARY KEY,
  public_key TEXT,
  status TEXT,
  geo TEXT,
  last_seen TIMESTAMP,
  service_url TEXT
); 