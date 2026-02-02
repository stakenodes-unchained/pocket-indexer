-- ===================================================================
-- SYSTEM CONFIGURATION MANAGEMENT
-- ===================================================================
-- This migration implements the system configuration management including:
-- - System configuration table for storing runtime configurations
-- - Configuration categories for Worker, Block Results, Memory, Performance, etc.
-- - Rate limiting configuration enhancements
-- - Configuration change audit log
-- ===================================================================

-- 1. Create system_config table for runtime configurations
CREATE TABLE IF NOT EXISTS system_config (
  id SERIAL PRIMARY KEY,
  category VARCHAR(100) NOT NULL,
  key VARCHAR(200) NOT NULL,
  value TEXT NOT NULL,
  value_type VARCHAR(50) NOT NULL DEFAULT 'string', -- 'string', 'integer', 'float', 'boolean', 'json'
  description TEXT,
  default_value TEXT,
  min_value TEXT, -- For numeric validation
  max_value TEXT, -- For numeric validation
  is_sensitive BOOLEAN DEFAULT FALSE, -- Hide value in responses
  requires_restart BOOLEAN DEFAULT FALSE, -- Requires service restart to take effect
  is_active BOOLEAN DEFAULT TRUE,
  updated_by INTEGER REFERENCES api_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(category, key)
);

-- 2. Create configuration audit log table
CREATE TABLE IF NOT EXISTS config_audit_log (
  id BIGSERIAL PRIMARY KEY,
  config_id INTEGER REFERENCES system_config(id) ON DELETE SET NULL,
  category VARCHAR(100) NOT NULL,
  key VARCHAR(200) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by INTEGER REFERENCES api_accounts(id) ON DELETE SET NULL,
  change_reason TEXT,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_system_config_category ON system_config(category);
CREATE INDEX IF NOT EXISTS idx_system_config_key ON system_config(key);
CREATE INDEX IF NOT EXISTS idx_system_config_active ON system_config(is_active);
CREATE INDEX IF NOT EXISTS idx_config_audit_log_config_id ON config_audit_log(config_id);
CREATE INDEX IF NOT EXISTS idx_config_audit_log_category ON config_audit_log(category);
CREATE INDEX IF NOT EXISTS idx_config_audit_log_created_at ON config_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_config_audit_log_changed_by ON config_audit_log(changed_by);

-- 4. Create trigger for updated_at
DROP TRIGGER IF EXISTS update_system_config_updated_at ON system_config;
CREATE TRIGGER update_system_config_updated_at BEFORE UPDATE ON system_config
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. Insert default Worker Configuration
INSERT INTO system_config (category, key, value, value_type, description, default_value, min_value, max_value, requires_restart) VALUES
('worker', 'WORKER_CONCURRENCY', '10', 'integer', 'Number of concurrent worker threads', '2', '1', '16', TRUE),
('worker', 'HISTORICAL_BATCH_SIZE', '80', 'integer', 'Batch size for historical processing', '10', '1', '100', FALSE),
('worker', 'CLUSTER_WORKERS', '4', 'integer', 'Number of cluster workers for API server', '4', '1', '16', TRUE),
('worker', 'PAGE_SIZE', '50', 'integer', 'Default pagination size for API responses', '50', '10', '500', FALSE)
ON CONFLICT (category, key) DO NOTHING;

-- 6. Insert default Block Results Workers Configuration
INSERT INTO system_config (category, key, value, value_type, description, default_value, min_value, max_value, requires_restart) VALUES
('block_results', 'BLOCK_RESULTS_WORKER_COUNT', '4', 'integer', 'Number of block result workers', '2', '1', '10', TRUE),
('block_results', 'BLOCK_RESULTS_POLL_INTERVAL_MS', '500', 'integer', 'Polling interval in milliseconds', '500', '100', '5000', FALSE),
('block_results', 'BLOCK_RESULTS_BATCH_SIZE', '5', 'integer', 'Batch size for block results processing', '8', '1', '50', FALSE),
('block_results', 'BLOCK_RESULTS_PARALLEL_LIMIT', '3', 'integer', 'Maximum parallel operations', '10', '1', '50', FALSE),
('block_results', 'BLOCK_RESULTS_RATE_LIMIT_MS', '100', 'integer', 'Rate limiting interval in milliseconds', '100', '0', '1000', FALSE),
('block_results', 'BLOCK_RESULTS_STATS_INTERVAL_MS', '30000', 'integer', 'Stats reporting interval in milliseconds', '30000', '5000', '300000', FALSE),
('block_results', 'BLOCK_RESULTS_ASYNC_EVENTS', 'true', 'boolean', 'Enable async event processing', 'true', NULL, NULL, FALSE),
('block_results', 'BLOCK_RESULTS_LAG_BLOCKS', '5', 'integer', 'Block lag threshold', '5', '1', '100', FALSE),
('block_results', 'BLOCK_RESULTS_CURRENT_WINDOW_BLOCKS', '5000', 'integer', 'Current window size in blocks', '50', '10', '500', FALSE),
('block_results', 'BLOCK_RESULTS_LEASE_SCAN_COUNT', '100', 'integer', 'Scan count for leases', '8', '1', '50', FALSE),
('block_results', 'BLOCK_RESULTS_HEARTBEAT_INTERVAL_MS', '60000', 'integer', 'Heartbeat interval in milliseconds', '60000', '10000', '300000', FALSE),
('block_results', 'BLOCK_RESULTS_EVENT_CONCURRENCY', '50', 'integer', 'Event concurrency level', '50', '1', '200', FALSE),
('block_results', 'BLOCK_RESULTS_TX_LOG_BATCH_SIZE', '50', 'integer', 'Transaction log batch size', '50', '10', '500', FALSE)
ON CONFLICT (category, key) DO NOTHING;

-- 7. Insert default Monitoring and Backfill Configuration
INSERT INTO system_config (category, key, value, value_type, description, default_value, min_value, max_value, requires_restart) VALUES
('monitoring', 'GAP_CHECK_INTERVAL_MS', '30000', 'integer', 'Gap checking interval in milliseconds', '30000', '5000', '300000', FALSE),
('monitoring', 'MONITOR_INTERVAL_MS', '30000', 'integer', 'Monitoring interval in milliseconds', '30000', '5000', '300000', FALSE),
('monitoring', 'HISTORICAL_HEARTBEAT_INTERVAL_MS', '30000', 'integer', 'Historical sync heartbeat interval', '30000', '5000', '300000', FALSE),
('monitoring', 'HISTORICAL_RESTART_INTERVAL_MS', '300000', 'integer', 'Historical sync restart interval', '300000', '60000', '3600000', FALSE),
('monitoring', 'EVENT_BACKFILL_BATCH_SIZE', '100', 'integer', 'Event backfill batch size', '100', '10', '1000', FALSE)
ON CONFLICT (category, key) DO NOTHING;

-- 8. Insert default Memory Management Configuration
INSERT INTO system_config (category, key, value, value_type, description, default_value, min_value, max_value, requires_restart) VALUES
('memory', 'TX_EXPIRE_TIME', '2592000', 'integer', 'Transaction data expiration in seconds (default 30 days)', '2592000', '86400', '31536000', FALSE),
('memory', 'HISTORY_CACHE_TTL', '3600', 'integer', 'History data cache TTL in seconds (default 1 hour)', '3600', '60', '86400', FALSE),
('memory', 'NODE_HEAP_SIZE_MB', '32768', 'integer', 'Node.js heap size limit in MB', '32768', '512', '65536', TRUE),
('memory', 'MEMORY_WARNING_THRESHOLD_GB', '12', 'integer', 'Memory warning threshold in GB', '12', '1', '64', FALSE)
ON CONFLICT (category, key) DO NOTHING;

-- 9. Insert default Performance Tuning Configuration
INSERT INTO system_config (category, key, value, value_type, description, default_value, min_value, max_value, requires_restart) VALUES
('performance', 'PROCESSING_DELAY', '50', 'integer', 'Delay between transaction batches to prevent Redis overload (ms)', '100', '0', '5000', FALSE),
('performance', 'REWARD_ANALYTICS_REFRESH_INTERVAL_MS', '900000', 'integer', 'Reward analytics refresh interval (default 15 minutes)', '900000', '60000', '3600000', FALSE)
ON CONFLICT (category, key) DO NOTHING;

-- 10. Insert default Proof Parser Configuration
INSERT INTO system_config (category, key, value, value_type, description, default_value, min_value, max_value, requires_restart) VALUES
('proof_parser', 'PROOF_PARSER_POLL_INTERVAL', '10000', 'integer', 'Proof parser polling interval in milliseconds', '10000', '1000', '60000', FALSE),
('proof_parser', 'PROOF_PARSER_BATCH_SIZE', '100', 'integer', 'Proof parser batch size', '100', '10', '1000', FALSE),
('proof_parser', 'PROOF_PARSER_HEALTH_CHECK_INTERVAL', '5000', 'integer', 'Health check interval in milliseconds', '5000', '1000', '30000', FALSE)
ON CONFLICT (category, key) DO NOTHING;

-- 11. Insert default Supplier Enrichment and Validator Refresh Configuration
INSERT INTO system_config (category, key, value, value_type, description, default_value, min_value, max_value, requires_restart) VALUES
('enrichment', 'ENABLE_SUPPLIER_ENRICHMENT', 'false', 'boolean', 'Enable supplier enrichment feature', 'false', NULL, NULL, FALSE),
('enrichment', 'SUPPLIER_ENRICHMENT_BATCH', '200', 'integer', 'Supplier enrichment batch size', '200', '10', '1000', FALSE),
('enrichment', 'SUPPLIER_ENRICHMENT_INTERVAL_MS', '3600000', 'integer', 'Supplier enrichment interval (default 1 hour)', '3600000', '300000', '86400000', FALSE),
('enrichment', 'ENABLE_VALIDATOR_REFRESH', 'true', 'boolean', 'Enable validator refresh feature', 'true', NULL, NULL, FALSE),
('enrichment', 'VALIDATOR_REFRESH_INTERVAL_MS', '21600000', 'integer', 'Validator refresh interval (default 6 hours)', '21600000', '300000', '86400000', FALSE)
ON CONFLICT (category, key) DO NOTHING;

-- 12. Insert default Rate Limiting Configuration (extends existing rate_limit_rules)
INSERT INTO system_config (category, key, value, value_type, description, default_value, min_value, max_value, requires_restart) VALUES
('rate_limiting', 'RATE_LIMIT_ENABLED', 'true', 'boolean', 'Enable rate limiting globally', 'true', NULL, NULL, FALSE),
('rate_limiting', 'RATE_LIMIT_WINDOW_MS', '60000', 'integer', 'Default rate limit window in milliseconds', '60000', '1000', '3600000', FALSE),
('rate_limiting', 'RATE_LIMIT_MAX_REQUESTS', '1000', 'integer', 'Default max requests per window', '1000', '10', '100000', FALSE),
('rate_limiting', 'RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS', 'false', 'boolean', 'Skip counting successful requests', 'false', NULL, NULL, FALSE),
('rate_limiting', 'RATE_LIMIT_SKIP_FAILED_REQUESTS', 'false', 'boolean', 'Skip counting failed requests', 'false', NULL, NULL, FALSE),
('rate_limiting', 'RATE_LIMIT_KEY_PREFIX', 'rl:', 'string', 'Redis key prefix for rate limiting', 'rl:', NULL, NULL, FALSE)
ON CONFLICT (category, key) DO NOTHING;

-- 13. Add System Configuration module for RBAC
INSERT INTO modules (name, slug, description, endpoints, is_active) VALUES
('System Configuration', 'system-config', 'Manage system configuration settings',
 '["GET /api/admin/config", "GET /api/admin/config/*", "PUT /api/admin/config/*", "POST /api/admin/config/reload", "GET /api/admin/config/audit"]'::jsonb,
 TRUE)
ON CONFLICT (slug) DO NOTHING;

-- 14. Grant super-admin access to system configuration module
INSERT INTO role_module_access (role_id, module_id, permissions)
SELECT r.id, m.id, '{"read": true, "write": true, "delete": true, "admin": true}'::jsonb
FROM roles r CROSS JOIN modules m
WHERE r.slug = 'super-admin' AND m.slug = 'system-config'
ON CONFLICT (role_id, module_id) DO NOTHING;

-- 15. Add comments
COMMENT ON TABLE system_config IS 'Runtime system configuration settings manageable via API';
COMMENT ON TABLE config_audit_log IS 'Audit log for configuration changes';
COMMENT ON COLUMN system_config.category IS 'Configuration category (worker, block_results, memory, performance, etc.)';
COMMENT ON COLUMN system_config.key IS 'Configuration key name matching environment variable';
COMMENT ON COLUMN system_config.value_type IS 'Data type for validation (string, integer, float, boolean, json)';
COMMENT ON COLUMN system_config.requires_restart IS 'Whether changing this config requires service restart';
COMMENT ON COLUMN system_config.is_sensitive IS 'Whether to hide value in API responses (for secrets)';
