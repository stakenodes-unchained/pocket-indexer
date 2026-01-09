-- Migration 044: API Authentication Tables
-- Creates tables for token-based authentication system

-- API Accounts Table
CREATE TABLE IF NOT EXISTS api_accounts (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255), -- NULL for passwordless accounts (email-only)
  name VARCHAR(255),
  organization VARCHAR(255),
  status VARCHAR(50) DEFAULT 'active', -- active, suspended, deleted
  email_verified BOOLEAN DEFAULT false,
  email_verification_token VARCHAR(255),
  email_verification_expires_at TIMESTAMP,
  password_reset_token VARCHAR(255),
  password_reset_expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_login_at TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb -- for future extensibility (payment info, etc.)
);

CREATE INDEX IF NOT EXISTS idx_api_accounts_email ON api_accounts(email);
CREATE INDEX IF NOT EXISTS idx_api_accounts_status ON api_accounts(status);

-- API Tokens Table
CREATE TABLE IF NOT EXISTS api_tokens (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES api_accounts(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) UNIQUE NOT NULL, -- SHA-256 hash of the token
  token_prefix VARCHAR(20) NOT NULL, -- First 8 chars after prefix for display (pk_live_xxxx)
  name VARCHAR(255), -- User-friendly name for the token
  status VARCHAR(50) DEFAULT 'active', -- active, revoked, expired
  last_used_at TIMESTAMP,
  expires_at TIMESTAMP, -- NULL for no expiration
  created_at TIMESTAMP DEFAULT NOW(),
  revoked_at TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb -- for future extensibility
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_token_hash ON api_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_api_tokens_account_id ON api_tokens(account_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_status ON api_tokens(status);

-- API Token Usage Table (Optional, for analytics and rate limiting)
CREATE TABLE IF NOT EXISTS api_token_usage (
  id SERIAL PRIMARY KEY,
  token_id INTEGER NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
  endpoint VARCHAR(255) NOT NULL,
  method VARCHAR(10) NOT NULL,
  status_code INTEGER,
  response_time_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_token_usage_token_id ON api_token_usage(token_id);
CREATE INDEX IF NOT EXISTS idx_api_token_usage_created_at ON api_token_usage(created_at);

