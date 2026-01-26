-- ===================================================================
-- USER MANAGEMENT SYSTEM - Complete Admin Module
-- ===================================================================
-- This migration implements the full user management system including:
-- - Users table (already exists as api_accounts)
-- - Roles and permissions
-- - Modules and access control
-- - API logging and analytics
-- - Rate limiting configuration
-- ===================================================================

-- 1. Create roles table
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  slug VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  is_system_role BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create modules table
CREATE TABLE IF NOT EXISTS modules (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  slug VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  endpoints JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create role_module_access table (junction table with permissions)
CREATE TABLE IF NOT EXISTS role_module_access (
  id SERIAL PRIMARY KEY,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  permissions JSONB DEFAULT '{"read": false, "write": false, "delete": false, "admin": false}'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(role_id, module_id)
);

-- 4. Add role_id to api_accounts if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'api_accounts' AND column_name = 'role_id'
  ) THEN
    ALTER TABLE api_accounts ADD COLUMN role_id INTEGER REFERENCES roles(id);
  END IF;
END $$;

-- 5. Add first_name and last_name if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'api_accounts' AND column_name = 'first_name'
  ) THEN
    ALTER TABLE api_accounts ADD COLUMN first_name VARCHAR(100);
    ALTER TABLE api_accounts ADD COLUMN last_name VARCHAR(100);
  END IF;
END $$;

-- 6. Create api_logs table for tracking all API requests
CREATE TABLE IF NOT EXISTS api_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES api_accounts(id) ON DELETE SET NULL,
  endpoint TEXT NOT NULL,
  method VARCHAR(10) NOT NULL,
  status_code INTEGER NOT NULL,
  response_time_ms INTEGER,
  request_body_size INTEGER,
  response_body_size INTEGER,
  ip_address VARCHAR(45),
  user_agent TEXT,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Create user_usage_summary table for aggregated analytics
CREATE TABLE IF NOT EXISTS user_usage_summary (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES api_accounts(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_requests INTEGER DEFAULT 0,
  successful_requests INTEGER DEFAULT 0,
  failed_requests INTEGER DEFAULT 0,
  total_data_transferred BIGINT DEFAULT 0,
  avg_response_time INTEGER,
  unique_endpoints_used INTEGER DEFAULT 0,
  most_used_endpoint TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, date)
);

-- 8. Create rate_limit_rules table
CREATE TABLE IF NOT EXISTS rate_limit_rules (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  target_type VARCHAR(50) NOT NULL, -- 'global', 'role', 'user', 'endpoint'
  target_id INTEGER, -- role_id or user_id if applicable
  endpoint_pattern TEXT, -- endpoint pattern if applicable
  requests_limit INTEGER NOT NULL,
  window_seconds INTEGER NOT NULL DEFAULT 60,
  enabled BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 0, -- higher priority rules are checked first
  created_by INTEGER REFERENCES api_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_api_accounts_role_id ON api_accounts(role_id);
CREATE INDEX IF NOT EXISTS idx_api_accounts_status ON api_accounts(status);
CREATE INDEX IF NOT EXISTS idx_api_accounts_email ON api_accounts(email);
CREATE INDEX IF NOT EXISTS idx_role_module_access_role_id ON role_module_access(role_id);
CREATE INDEX IF NOT EXISTS idx_role_module_access_module_id ON role_module_access(module_id);
CREATE INDEX IF NOT EXISTS idx_api_logs_user_id ON api_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_api_logs_created_at ON api_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_endpoint ON api_logs(endpoint);
CREATE INDEX IF NOT EXISTS idx_user_usage_summary_user_id ON user_usage_summary(user_id);
CREATE INDEX IF NOT EXISTS idx_user_usage_summary_date ON user_usage_summary(date DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limit_rules_target_type ON rate_limit_rules(target_type);
CREATE INDEX IF NOT EXISTS idx_rate_limit_rules_enabled ON rate_limit_rules(enabled);

-- 10. Insert default roles
INSERT INTO roles (name, slug, description, is_system_role) VALUES
('Super Admin', 'super-admin', 'Full access to everything', TRUE),
('Admin', 'admin', 'Manage users, view analytics, configure settings', TRUE),
('Developer', 'developer', 'Access to API endpoints, view own analytics', TRUE),
('Viewer', 'viewer', 'Read-only access to allowed modules', TRUE),
('API Consumer', 'api-consumer', 'Only API access, no dashboard', TRUE)
ON CONFLICT (slug) DO NOTHING;

-- 11. Insert default modules
INSERT INTO modules (name, slug, description, endpoints, is_active) VALUES
('User Management', 'user-management', 'Manage users and roles', '["GET /api/admin/users", "POST /api/admin/users", "PUT /api/admin/users/:id", "DELETE /api/admin/users/:id", "GET /api/admin/roles", "POST /api/admin/roles"]'::jsonb, TRUE),
('Analytics Dashboard', 'analytics', 'View usage statistics', '["GET /api/admin/analytics/*", "GET /api/admin/logs/*"]'::jsonb, TRUE),
('Rate Limit Config', 'rate-limiting', 'Configure rate limits', '["GET /api/admin/rate-limits/*", "POST /api/admin/rate-limits", "PUT /api/admin/rate-limits/:id"]'::jsonb, TRUE),
('Indexer', 'indexer', 'Access indexer APIs', '["GET /api/v1/indexer/*", "POST /api/v1/indexer/*"]'::jsonb, TRUE),
('Proof Parser', 'proof-parser', 'Access proof parser APIs', '["GET /api/v1/proof/*", "POST /api/v1/proof/*"]'::jsonb, TRUE),
('Blocks', 'blocks', 'Access block data APIs', '["GET /api/v1/blocks/*"]'::jsonb, TRUE),
('Events', 'events', 'Access events APIs', '["GET /api/v1/events/*"]'::jsonb, TRUE),
('Transactions', 'transactions', 'Access transaction APIs', '["GET /api/v1/transactions/*", "POST /api/v1/transactions"]'::jsonb, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- 12. Set up default permissions for roles
-- Super Admin gets full access to all modules
INSERT INTO role_module_access (role_id, module_id, permissions)
SELECT r.id, m.id, '{"read": true, "write": true, "delete": true, "admin": true}'::jsonb
FROM roles r CROSS JOIN modules m
WHERE r.slug = 'super-admin'
ON CONFLICT (role_id, module_id) DO NOTHING;

-- Admin gets access to user management, analytics, and rate limiting
INSERT INTO role_module_access (role_id, module_id, permissions)
SELECT r.id, m.id, '{"read": true, "write": true, "delete": true, "admin": false}'::jsonb
FROM roles r CROSS JOIN modules m
WHERE r.slug = 'admin' AND m.slug IN ('user-management', 'analytics', 'rate-limiting')
ON CONFLICT (role_id, module_id) DO NOTHING;

-- Developer gets read/write access to API modules
INSERT INTO role_module_access (role_id, module_id, permissions)
SELECT r.id, m.id, '{"read": true, "write": true, "delete": false, "admin": false}'::jsonb
FROM roles r CROSS JOIN modules m
WHERE r.slug = 'developer' AND m.slug IN ('indexer', 'proof-parser', 'blocks', 'events', 'transactions')
ON CONFLICT (role_id, module_id) DO NOTHING;

-- Developer gets read-only access to their own analytics
INSERT INTO role_module_access (role_id, module_id, permissions)
SELECT r.id, m.id, '{"read": true, "write": false, "delete": false, "admin": false}'::jsonb
FROM roles r CROSS JOIN modules m
WHERE r.slug = 'developer' AND m.slug = 'analytics'
ON CONFLICT (role_id, module_id) DO NOTHING;

-- Viewer gets read-only access to API modules
INSERT INTO role_module_access (role_id, module_id, permissions)
SELECT r.id, m.id, '{"read": true, "write": false, "delete": false, "admin": false}'::jsonb
FROM roles r CROSS JOIN modules m
WHERE r.slug = 'viewer' AND m.slug IN ('indexer', 'proof-parser', 'blocks', 'events', 'transactions')
ON CONFLICT (role_id, module_id) DO NOTHING;

-- API Consumer gets read-only access to API modules
INSERT INTO role_module_access (role_id, module_id, permissions)
SELECT r.id, m.id, '{"read": true, "write": false, "delete": false, "admin": false}'::jsonb
FROM roles r CROSS JOIN modules m
WHERE r.slug = 'api-consumer' AND m.slug IN ('blocks', 'events', 'transactions')
ON CONFLICT (role_id, module_id) DO NOTHING;

-- 13. Set default role for existing users (API Consumer)
UPDATE api_accounts
SET role_id = (SELECT id FROM roles WHERE slug = 'api-consumer')
WHERE role_id IS NULL;

-- 14. Insert default rate limit rules
INSERT INTO rate_limit_rules (name, target_type, target_id, endpoint_pattern, requests_limit, window_seconds, enabled, priority) VALUES
('System Global', 'global', NULL, NULL, 10000, 60, TRUE, 0),
('Developer Tier', 'role', (SELECT id FROM roles WHERE slug = 'developer'), NULL, 1000, 60, TRUE, 40),
('Viewer Tier', 'role', (SELECT id FROM roles WHERE slug = 'viewer'), NULL, 100, 60, TRUE, 40),
('API Consumer Tier', 'role', (SELECT id FROM roles WHERE slug = 'api-consumer'), NULL, 500, 60, TRUE, 40)
ON CONFLICT DO NOTHING;

-- 15. Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- 16. Create triggers for updated_at
DROP TRIGGER IF EXISTS update_roles_updated_at ON roles;
CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON roles
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_modules_updated_at ON modules;
CREATE TRIGGER update_modules_updated_at BEFORE UPDATE ON modules
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_role_module_access_updated_at ON role_module_access;
CREATE TRIGGER update_role_module_access_updated_at BEFORE UPDATE ON role_module_access
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_rate_limit_rules_updated_at ON rate_limit_rules;
CREATE TRIGGER update_rate_limit_rules_updated_at BEFORE UPDATE ON rate_limit_rules
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_usage_summary_updated_at ON user_usage_summary;
CREATE TRIGGER update_user_usage_summary_updated_at BEFORE UPDATE ON user_usage_summary
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE roles IS 'User roles for RBAC system';
COMMENT ON TABLE modules IS 'System modules that can be accessed by roles';
COMMENT ON TABLE role_module_access IS 'Maps roles to modules with specific permissions';
COMMENT ON TABLE api_logs IS 'Logs all API requests for analytics and auditing';
COMMENT ON TABLE user_usage_summary IS 'Aggregated daily usage statistics per user';
COMMENT ON TABLE rate_limit_rules IS 'Rate limiting rules configuration';
