# Token-Based Authentication - Quick Start Guide

## Overview

This guide provides a quick reference for implementing token-based authentication for the Pocket Network Indexer API.

## Documents Created

1. **`TOKEN_AUTHENTICATION_IMPLEMENTATION_PLAN.md`** - Comprehensive implementation plan with:
   - Architecture overview
   - Database schema design
   - Implementation phases
   - Security considerations
   - Timeline estimates

2. **`ENDPOINT_CATEGORIZATION.md`** - Complete list of all API endpoints for categorization:
   - All 70+ endpoints listed
   - Categories: INTERNAL, TOKEN, PUBLIC
   - Ready for your review and categorization

## Key Components

### 1. Database Schema

Three main tables:
- `api_accounts` - User account information
- `api_tokens` - API tokens (hashed storage)
- `api_token_usage` - Usage tracking (optional)

### 2. Authentication Flow

```
Client Request
    ↓
Authorization: Bearer <token>
    ↓
Extract Token
    ↓
Hash Token → Lookup in Database
    ↓
Validate (active, not expired, not revoked)
    ↓
Attach Account Info to Request
    ↓
Track Usage (optional)
    ↓
Continue to Endpoint Handler
```

### 3. Token Format

- **Production**: `pk_live_<64_char_hex>`
- **Test** (future): `pk_test_<64_char_hex>`
- **Storage**: SHA-256 hash in database
- **Display**: Only show prefix (`pk_live_xxxx`) after creation

### 4. Endpoint Categories

- **PUBLIC**: No authentication (registration, health checks)
- **TOKEN**: Requires valid API token (data endpoints)
- **INTERNAL**: No public access (admin, monitoring, logs)

## Implementation Steps

### Step 1: Review & Categorize Endpoints
- Open `ENDPOINT_CATEGORIZATION.md`
- Review each endpoint
- Mark as INTERNAL, TOKEN, or PUBLIC
- Add any notes or clarifications

### Step 2: Database Setup
- Create migrations for `api_accounts`, `api_tokens`, `api_token_usage`
- Run migrations
- Verify schema

### Step 3: Core Authentication
- Create `server/middleware/auth.js`
- Implement token validation
- Create `server/services/authService.js` for database operations

### Step 4: Account Management
- Implement registration endpoint
- Implement token management endpoints
- Test registration flow

### Step 5: Apply Protection
- Apply auth middleware to API server
- Configure endpoint categories based on your categorization
- Test protected endpoints

### Step 6: Documentation
- Create public API documentation
- Add authentication examples
- Document error responses

## New Endpoints to Create

### Authentication Endpoints

1. **POST** `/api/v1/auth/register`
   - Register new account (with or without password)
   - Returns account + API token
   - PUBLIC endpoint

2. **POST** `/api/v1/auth/login`
   - Login with email + password
   - Returns account info + token list (prefixes only)
   - PUBLIC endpoint

3. **POST** `/api/v1/auth/request-tokens` (Optional - passwordless)
   - Request token retrieval via email
   - Sends email with token information
   - PUBLIC endpoint

4. **GET** `/api/v1/auth/account`
   - Get account information
   - Requires authentication

5. **GET** `/api/v1/auth/tokens`
   - List all tokens for account (prefixes only, not full tokens)
   - Requires authentication

6. **POST** `/api/v1/auth/tokens`
   - Create new token
   - Returns full token (shown once)
   - Requires authentication

7. **DELETE** `/api/v1/auth/tokens/:token_id`
   - Revoke token
   - Requires authentication

8. **POST** `/api/v1/auth/tokens/:token_id/regenerate`
   - Regenerate token (revoke old, create new)
   - Returns new full token (shown once)
   - Requires authentication

## Example Usage

### Registration (with password)
```bash
curl -X POST http://localhost:3006/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "secure_password",
    "name": "John Doe",
    "organization": "Acme Corp"
  }'
```

### Login (if user loses token)
```bash
curl -X POST http://localhost:3006/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "secure_password"
  }'
```

### View Tokens (after login or with existing token)
```bash
curl -X GET http://localhost:3006/api/v1/auth/tokens \
  -H "Authorization: Bearer pk_live_existing_token..." \
  -H "Content-Type: application/json"
```

### Using Token for API Calls
```bash
curl -X GET http://localhost:3006/api/v1/transactions \
  -H "Authorization: Bearer pk_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2" \
  -H "Content-Type: application/json"
```

**Note**: See `AUTHENTICATION_FLOW_EXPLANATION.md` for detailed flow diagrams and passwordless options.

## Security Best Practices

1. **Token Storage**
   - Never store plaintext tokens
   - Always hash before storage (SHA-256)
   - Only show token once on creation

2. **Token Validation**
   - Check token status (active/revoked)
   - Check expiration (if set)
   - Validate token format

3. **Error Handling**
   - Don't leak information in error messages
   - Return 401 for invalid/missing tokens
   - Return 403 for revoked/expired tokens

4. **Rate Limiting** (Future)
   - Implement per-token rate limits
   - Implement per-account rate limits
   - Track usage for analytics

## Next Actions

1. ✅ **Review** `TOKEN_AUTHENTICATION_IMPLEMENTATION_PLAN.md`
2. ✅ **Categorize** endpoints in `ENDPOINT_CATEGORIZATION.md`
3. ⬜ **Approve** plan and categorization
4. ⬜ **Create** database migrations
5. ⬜ **Implement** authentication middleware
6. ⬜ **Build** account management endpoints
7. ⬜ **Apply** protection to endpoints
8. ⬜ **Create** documentation

## Questions to Answer

Before proceeding with implementation, please answer:

1. **Token Format**: Is `pk_live_` prefix acceptable?
2. **Email Verification**: Should we verify emails or allow any email?
3. **Rate Limiting**: What limits should we set initially?
4. **Token Expiration**: Should tokens expire by default or be permanent?
5. **Internal Endpoints**: Should internal endpoints return 404 or 403?
6. **Documentation Hosting**: Where will public documentation be hosted?

## Support

For questions or clarifications:
- Review the detailed plan in `TOKEN_AUTHENTICATION_IMPLEMENTATION_PLAN.md`
- Check endpoint list in `ENDPOINT_CATEGORIZATION.md`
- Refer to this quick start guide

---

**Status**: Planning Phase Complete ✅
**Next**: Awaiting endpoint categorization and plan approval

