CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  height INTEGER UNIQUE,
  hash TEXT,
  timestamp TIMESTAMP,
  proposer TEXT,
  chain TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  hash TEXT,
  block_id TEXT REFERENCES blocks(id),
  sender TEXT,
  recipient TEXT,
  amount NUMERIC,
  fee NUMERIC,
  memo TEXT,
  type TEXT,
  status TEXT,
  chain TEXT,
  tx_data JSONB,
  timestamp TIMESTAMP
); 