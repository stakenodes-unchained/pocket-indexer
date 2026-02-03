# API Endpoint Categorization

This document lists all API endpoints for categorization. Please mark each endpoint as:
- **INTERNAL**: Internal use only, no public access
- **TOKEN**: Requires valid API token for access
- **PUBLIC**: No authentication required (public endpoints)

---

## Network Growth Endpoints

| Method | Endpoint | Current Status | Category | Notes |
|--------|----------|----------------|----------|-------|
| GET | `/api/v1/network-growth` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Legacy combined endpoint |
| GET | `/api/v1/network-growth/performance` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Performance metrics |
| GET | `/api/v1/network-growth/entities` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Entity growth metrics |
| GET | `/api/v1/network-growth/summary` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Summary statistics |

---

## Transaction Endpoints

| Method | Endpoint | Current Status | Category | Notes |
|--------|----------|----------------|----------|-------|
| GET | `/api/v1/transactions` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | List transactions with filters |
| POST | `/api/v1/transactions` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | List transactions (POST variant) |
| GET | `/api/v1/transactions/count` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Transaction count |
| GET | `/api/v1/transactions/stats` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Transaction statistics |
| POST | `/api/v1/transactions/stats` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Transaction statistics (POST) |
| GET | `/api/v1/transactions/:transaction_id` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Get transaction by ID |

---

## Block Endpoints

| Method | Endpoint | Current Status | Category | Notes |
|--------|----------|----------------|----------|-------|
| GET | `/api/v1/blocks` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | List blocks with pagination |
| GET | `/api/v1/blocks/:block_id` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | Get block by ID or height |

---

## Chain Endpoints

| Method | Endpoint | Current Status | Category | Notes |
|--------|----------|----------------|----------|-------|
| GET | `/api/v1/chains` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | List available chains |
| GET | `/api/v1/chains/stats` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Chain statistics |

---

## Application Endpoints

| Method | Endpoint | Current Status | Category | Notes |
|--------|----------|----------------|----------|-------|
| GET | `/api/v1/applications` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | List applications |
| GET | `/api/v1/applications/:address` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Get application by address |
| GET | `/api/v1/applications/:address/usage` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Application usage metrics |
| GET | `/api/v1/applications/:address/claims/usage` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Application claims usage |

---

## Supplier Endpoints

| Method | Endpoint | Current Status | Category | Notes |
|--------|----------|----------------|----------|-------|
| GET | `/api/v1/suppliers` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | List suppliers |
| GET | `/api/v1/suppliers/:address` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Get supplier by address |
| GET | `/api/v1/suppliers/:address/performance` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Supplier performance metrics (legacy, proof-submissions-based) |
| GET | `/api/v1/suppliers/:address/claims/performance` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Supplier claims performance (claims-based) |
| GET | `/api/v1/suppliers/search` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | Search suppliers by owner/operator and service URL |
| GET | `/api/v1/suppliers/performance` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | Supplier performance list (claims-based) |
| POST | `/api/v1/suppliers/performance` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Supplier performance (POST, multi-supplier) |
| GET | `/api/v1/suppliers/owners` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | Supplier owner leaderboard (claims-based) |

---

## Gateway Endpoints

| Method | Endpoint | Current Status | Category | Notes |
|--------|----------|----------------|----------|-------|
| GET | `/api/v1/gateways` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | List gateways |
| GET | `/api/v1/gateways/:address` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | Get gateway by address |

---

## Delegation Endpoints

| Method | Endpoint | Current Status | Category | Notes |
|--------|----------|----------------|----------|-------|
| GET | `/api/v1/delegations` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | List delegations |

---

## Staking Endpoints

| Method | Endpoint | Current Status | Category | Notes |
|--------|----------|----------------|----------|-------|
| GET | `/api/v1/staking` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | Staking information |

---

## Proof Submission Endpoints

| Method | Endpoint | Current Status | Category | Notes |
|--------|----------|----------------|----------|-------|
| GET | `/api/v1/proof-submissions` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | List proof submissions |
| POST | `/api/v1/proof-submissions` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | List proof submissions (POST) |
| GET | `/api/v1/proof-submissions/rewards` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | Reward analytics |
| POST | `/api/v1/proof-submissions/rewards` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Reward analytics (POST) |
| GET | `/api/v1/proof-submissions/rewards/refresh/status` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Refresh service status |
| POST | `/api/v1/proof-submissions/rewards/refresh` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Manually trigger refresh |
| GET | `/api/v1/proof-submissions/summary` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Proof submissions summary |
| POST | `/api/v1/proof-submissions/summary` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Proof submissions summary (POST) |

---

## Claims Endpoints

| Method | Endpoint | Current Status | Category | Notes |
|--------|----------|----------------|----------|-------|
| GET | `/api/v1/claims` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | List claims |
| POST | `/api/v1/claims` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | List claims (POST) |
| GET | `/api/v1/claims/rewards` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | Claims rewards |
| POST | `/api/v1/claims/rewards` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | Claims rewards (POST) |
| GET | `/api/v1/claims/summary` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | Claims summary |
| POST | `/api/v1/claims/summary` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | Claims summary (POST) |

---

## Validator Endpoints

| Method | Endpoint | Current Status | Category | Notes |
|--------|----------|----------------|----------|-------|
| GET | `/api/v1/validators/search` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Search validators and services |
| GET | `/api/v1/validators/performance` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Validator performance list |
| POST | `/api/v1/validators/performance` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Validator performance (POST) |
| GET | `/api/v1/validators/:operator_address/performance` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Validator detail performance |
| GET | `/api/v1/validators/domains` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Domain leaderboard |
| GET | `/api/v1/validators/owners` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Owner leaderboard |

---

## Service Endpoints

| Method | Endpoint | Current Status | Category | Notes |
|--------|----------|----------------|----------|-------|
| GET | `/api/v1/services/top-by-compute-units` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | Top services by compute units |
| POST | `/api/v1/services/top-by-compute-units` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Top services (POST) |
| GET | `/api/v1/services/top-by-performance` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | Top services by performance |
| POST | `/api/v1/services/top-by-performance` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Top services performance (POST) |
| GET | `/api/v1/services/:service_id` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | List staked applications and suppliers for a service |

---

## Admin/Job Management Endpoints

| Method | Endpoint | Current Status | Category | Notes |
|--------|----------|----------------|----------|-------|
| POST | `/api/v1/jobs` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Create background job |
| GET | `/api/v1/jobs` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | List jobs |
| GET | `/api/v1/jobs/:id` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Get job details |
| POST | `/api/v1/jobs/:id/cancel` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Cancel job |

---

## Health & Monitoring Endpoints

| Method | Endpoint | Current Status | Category | Notes |
|--------|----------|----------------|----------|-------|
| GET | `/api/v1/health/workers` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Worker health status |
| GET | `/api/v1/health/rpc` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | RPC health status |
| GET | `/api/v1/health/block-results-workers` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Block results worker health |
| GET | `/api/v1/health/rpc/history` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | RPC health history |
| GET | `/api/v1/health/workers/history` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Worker health history |
| GET | `/api/v1/health/block-results-workers/history` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Block results worker history |
| GET | `/api/v1/health/process/history` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Process health history |
| GET | `/api/v1/health/redis/history` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Redis health history |
| GET | `/api/v1/health/redis/keyspace/history` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Redis keyspace history |
| GET | `/api/v1/health/proof-parser` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Proof parser health (if enabled) |
| GET | `/api/v1/health/proof-parser/:chain` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Proof parser chain health |
| GET | `/api/v1/health/proof-parser/stats` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Proof parser statistics |

---

## Metrics Endpoints

| Method | Endpoint | Current Status | Category | Notes |
|--------|----------|----------------|----------|-------|
| GET | `/api/v1/metrics/chains` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Chain metrics overview |
| GET | `/api/v1/metrics/chains/:chain` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Chain metrics time-series |

---

## Log Viewer Endpoints

| Method | Endpoint | Current Status | Category | Notes |
|--------|----------|----------------|----------|-------|
| GET | `/api/v1/logs/containers` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | List Docker containers |
| GET | `/api/v1/logs/containers/:containerId` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Get container metadata |
| GET | `/api/v1/logs/containers/:containerId/history` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Get historical logs |
| WebSocket | `/api/v1/logs/stream` | Public | ✅ INTERNAL<br>⬜ TOKEN<br>⬜ PUBLIC | Real-time log streaming |

---

## Authentication Endpoints

| Method | Endpoint | Current Status | Category | Notes |
|--------|----------|----------------|----------|-------|
| POST | `/api/v1/auth/register` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | User registration (quick + full) |
| POST | `/api/v1/auth/login` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | Login with email/password, returns JWT |
| POST | `/api/v1/auth/refresh` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | Refresh access token with refresh token |
| POST | `/api/v1/auth/logout` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | Logout and revoke refresh token |
| POST | `/api/v1/auth/verify-email` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | Verify email with token |
| POST | `/api/v1/auth/resend-verification` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | Resend verification link |
| POST | `/api/v1/auth/forgot-password` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | Request password reset link |
| POST | `/api/v1/auth/reset-password` | Public | ⬜ INTERNAL<br>⬜ TOKEN<br>✅ PUBLIC | Reset password with token |
| GET | `/api/v1/auth/account` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Get account info (JWT_AUTH) |
| GET | `/api/v1/auth/tokens` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | List API tokens (JWT_AUTH) |
| POST | `/api/v1/auth/tokens` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Create new token (JWT_AUTH) |
| DELETE | `/api/v1/auth/tokens/:token_id` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Revoke token (JWT_AUTH) |
| POST | `/api/v1/auth/tokens/:token_id/regenerate` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Regenerate token (JWT_AUTH) |
| POST | `/api/v1/auth/logout-all` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Logout from all devices (JWT_AUTH) |
| PUT | `/api/v1/auth/password` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Change password (JWT_AUTH) |
| GET | `/api/v1/auth/verification-status` | Public | ⬜ INTERNAL<br>✅ TOKEN<br>⬜ PUBLIC | Get email verification status (JWT_AUTH) |

---

## Instructions for Categorization

1. **Review each endpoint** and determine its appropriate category
2. **Mark the category** by checking the appropriate box (✅)
3. **Add notes** if clarification is needed
4. **Consider the following**:
   - **INTERNAL**: Endpoints used only by internal systems, admin tools, or monitoring
   - **TOKEN**: Endpoints that should be accessible with a valid API token
   - **PUBLIC**: Endpoints that should remain publicly accessible (e.g., health checks, registration)

### Guidelines

- **Health endpoints**: Usually PUBLIC for monitoring tools, but could be INTERNAL if sensitive
- **Admin/Job endpoints**: Usually INTERNAL
- **Data retrieval endpoints**: Usually TOKEN
- **Analytics endpoints**: Usually TOKEN
- **Registration endpoint**: Must be PUBLIC
- **Log viewer endpoints**: Usually INTERNAL (sensitive system information)

---

## Summary

After categorization, we will:
1. Apply authentication middleware to TOKEN endpoints
2. Hide INTERNAL endpoints (return 404 for unauthorized access)
3. Keep PUBLIC endpoints accessible without authentication
4. Create documentation for TOKEN endpoints
5. Update API server with appropriate middleware

---

## Questions to Consider

1. Should health endpoints be PUBLIC (for external monitoring) or INTERNAL?
2. Should metrics endpoints be TOKEN or INTERNAL?
3. Should proof-submissions/rewards/refresh endpoints be INTERNAL (admin-only)?
4. Should log viewer endpoints be INTERNAL (sensitive)?
5. Are there any endpoints that should have different access levels for different operations (e.g., GET public but POST requires token)?

