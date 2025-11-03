-- Migration 019: Validators cache table for domain-based filtering and metadata

CREATE TABLE IF NOT EXISTS validators (
  operator_address TEXT PRIMARY KEY, -- poktvaloper...
  moniker TEXT,
  website TEXT,
  website_domain TEXT,
  status TEXT,
  jailed BOOLEAN,
  tokens NUMERIC,
  cached_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP
);

-- Indexes to support common query patterns
CREATE INDEX IF NOT EXISTS idx_validators_domain ON validators(website_domain);
CREATE INDEX IF NOT EXISTS idx_validators_status ON validators(status);

COMMENT ON TABLE validators IS 'Cached validator metadata from staking API for domain filtering and enrichment';
COMMENT ON COLUMN validators.website_domain IS 'Extracted host from description.website (e.g., grove.city)';


