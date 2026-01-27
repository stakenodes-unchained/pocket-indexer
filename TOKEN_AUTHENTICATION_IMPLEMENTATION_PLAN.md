# Token-Based Authentication Implementation Plan

## Overview

This document outlines the comprehensive plan for implementing token-based authentication for the Pocket Network Indexer API. The system will control access to APIs by requiring valid API tokens for most endpoints, while keeping certain endpoints internal-only.

## Goals

1. **Access Control**: Implement token-based authentication to restrict API access
2. **Account Management**: Allow users to register and obtain API tokens
3. **Endpoint Categorization**: Separate internal-only endpoints from publicly accessible ones
4. **Documentation**: Provide clear documentation for token-based API access
5. **Future-Ready**: Design system to support payment integration later

---

## Architecture Overview

### Components

1. **Database Layer**
   - `api_accounts` table: Store user account information
   - `api_tokens` table: Store API tokens with metadata
   - `api_token_usage` table: Track token usage for analytics/rate limiting

2. **Authentication Middleware**
   - Token validation middleware
   - Rate limiting middleware (optional, for future)
   - Usage tracking middleware

3. **Account Management Endpoints**
   - Registration endpoint
   - Token management endpoints
   - Account information endpoints

4. **API Documentation**
   - Public API documentation
   - Token usage examples
   - Endpoint categorization

---

## Implementation Phases

### Phase 1: Database Schema & Core Infrastructure

#### 1.1 Database Schema Design

**Table: `api_accounts`**
```sql
CREATE TABLE api_accounts (
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
  metadata JSONB -- for future extensibility (payment info, etc.)
);
```

**Table: `api_tokens`**
```sql
CREATE TABLE api_tokens (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES api_accounts(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) UNIQUE NOT NULL, -- SHA-256 hash of the token
  token_prefix VARCHAR(20) NOT NULL, -- First 8 chars for display (pk_live_xxxx)
  name VARCHAR(255), -- User-friendly name for the token
  status VARCHAR(50) DEFAULT 'active', -- active, revoked, expired
  last_used_at TIMESTAMP,
  expires_at TIMESTAMP, -- NULL for no expiration
  created_at TIMESTAMP DEFAULT NOW(),
  revoked_at TIMESTAMP,
  metadata JSONB -- for future extensibility
);

CREATE INDEX idx_api_tokens_token_hash ON api_tokens(token_hash);
CREATE INDEX idx_api_tokens_account_id ON api_tokens(account_id);
CREATE INDEX idx_api_tokens_status ON api_tokens(status);
```

**Table: `api_token_usage`** (Optional, for analytics)
```sql
CREATE TABLE api_token_usage (
  id SERIAL PRIMARY KEY,
  token_id INTEGER REFERENCES api_tokens(id) ON DELETE CASCADE,
  endpoint VARCHAR(255) NOT NULL,
  method VARCHAR(10) NOT NULL,
  status_code INTEGER,
  response_time_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_api_token_usage_token_id ON api_token_usage(token_id);
CREATE INDEX idx_api_token_usage_created_at ON api_token_usage(created_at);
```

#### 1.2 Token Generation Strategy

- **Format**: `pk_live_<random_64_char_hex>`
  - `pk_live_` prefix for production tokens
  - `pk_test_` prefix for test tokens (future)
  - 64-character hexadecimal random string
  - Total length: ~72 characters

- **Storage**:
  - Store SHA-256 hash in database
  - Store first 8 characters after prefix as `token_prefix` for display
  - Never return full token after creation (only on initial generation)

- **Security**:
  - Use `crypto.randomBytes()` for secure random generation
  - Hash tokens using SHA-256 before storage
  - Compare hashes during validation (never compare plaintext)

#### 1.3 Authentication Middleware

**Location**: `server/middleware/auth.js`

**Features**:
- Extract token from `Authorization: Bearer <token>` header
- Validate token format
- Lookup token hash in database
- Check token status (active, not expired, not revoked)
- Attach account info to `req.user` for downstream use
- Track usage (optional)

**Error Responses**:
- `401 Unauthorized`: Missing or invalid token
- `403 Forbidden`: Token revoked or expired
- `429 Too Many Requests`: Rate limit exceeded (future)

---

### Phase 2: Account Management Endpoints

#### 2.1 Registration Endpoint

**POST** `/api/v1/auth/register`

**Request Body**:
```json
{
  "email": "user@example.com",
  "name": "John Doe",
  "organization": "Acme Corp" // optional
}
```

**Response** (201 Created):
```json
{
  "data": {
    "account": {
      "id": 1,
      "email": "user@example.com",
      "name": "John Doe",
      "organization": "Acme Corp",
      "status": "active",
      "created_at": "2025-01-27T10:30:00Z"
    },
    "token": {
      "id": 1,
      "token": "pk_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2",
      "token_prefix": "pk_live_a1b2c3d4",
      "name": "Default Token",
      "created_at": "2025-01-27T10:30:00Z",
      "expires_at": null
    }
  },
  "message": "Account created successfully. Please save your API token - it will not be shown again."
}
```

**Business Logic**:
1. Validate email format and uniqueness
2. Create account record
3. Generate email verification token
4. Generate default API token
5. Send email verification email (optional, can be skipped for now)
6. Return account and token (token shown only once)
7. Send welcome email with token (optional, future)

**Note**: For passwordless accounts, users can later request tokens via email. For accounts with passwords, users can login to access their account.

**Error Responses**:
- `400 Bad Request`: Invalid email format or missing required fields
- `409 Conflict`: Email already registered

#### 2.2 Login Endpoint

**POST** `/api/v1/auth/login`

**Request Body**:
```json
{
  "email": "user@example.com",
  "password": "user_password" // optional if passwordless
}
```

**Response** (200 OK):
```json
{
  "data": {
    "account": {
      "id": 1,
      "email": "user@example.com",
      "name": "John Doe",
      "status": "active",
      "email_verified": true
    },
    "tokens": [
      {
        "id": 1,
        "token_prefix": "pk_live_a1b2c3d4",
        "name": "Default Token",
        "created_at": "2025-01-27T10:30:00Z",
        "last_used_at": "2025-01-28T15:30:00Z",
        "status": "active"
      }
    ]
  }
}
```

**Business Logic**:
1. Validate email format
2. Lookup account by email
3. If password provided: verify password hash
4. If passwordless: verify email is verified
5. Check account status (must be active)
6. Update `last_login_at`
7. Return account info and list of token prefixes (not full tokens)
8. Note: Full tokens are never returned after initial creation

**Error Responses**:
- `400 Bad Request`: Invalid email format or missing email
- `401 Unauthorized`: Invalid email or password
- `403 Forbidden`: Account suspended or email not verified (for passwordless)
- `404 Not Found`: Account not found

**Alternative: Email-Based Token Retrieval** (Passwordless Option)

If we want to avoid passwords entirely, we can use email-based token retrieval:

**POST** `/api/v1/auth/request-tokens`

**Request Body**:
```json
{
  "email": "user@example.com"
}
```

**Response** (200 OK):
```json
{
  "message": "If an account exists with this email, we've sent your token information to your email address."
}
```

**Business Logic**:
1. Validate email format
2. Lookup account by email
3. If account exists and email is verified:
   - Generate temporary access token (expires in 1 hour)
   - Send email with link to retrieve tokens
   - Or send email with token list (prefixes only, not full tokens)
4. Always return same message (don't reveal if email exists)
5. Rate limit: max 3 requests per email per hour

#### 2.3 Token Management Endpoints

**GET** `/api/v1/auth/tokens`
- List all tokens for authenticated account
- Requires authentication (token in header)

**POST** `/api/v1/auth/tokens`
- Create new token for account
- Requires authentication

**DELETE** `/api/v1/auth/tokens/:token_id`
- Revoke a token
- Requires authentication
- Soft delete (set status to 'revoked')

**GET** `/api/v1/auth/account`
- Get account information
- Requires authentication

**POST** `/api/v1/auth/tokens/:token_id/regenerate`
- Regenerate a token (revoke old, create new)
- Requires authentication

---

### Phase 3: Endpoint Protection

#### 3.1 Endpoint Categories

1. **Public Endpoints** (No authentication required)
   - Health checks
   - Public documentation
   - Registration endpoint

2. **Token-Protected Endpoints** (Require valid API token)
   - All data retrieval endpoints
   - Analytics endpoints
   - Search endpoints

3. **Internal-Only Endpoints** (No public access, admin-only)
   - Admin/job management
   - System health monitoring
   - Log viewer
   - Metrics/internal monitoring

#### 3.2 Middleware Application Strategy

**Option A: Whitelist Approach** (Recommended)
- Apply auth middleware globally
- Whitelist public endpoints
- Explicitly mark internal endpoints

**Option B: Blacklist Approach**
- Apply auth middleware selectively
- Mark each endpoint individually

**Recommended**: Option A for better security by default

#### 3.3 Middleware Implementation

```javascript
// server/middleware/auth.js
const authenticateToken = async (req, res, next) => {
  // Skip authentication for public endpoints
  if (isPublicEndpoint(req.path)) {
    return next();
  }
  
  // Skip authentication for internal endpoints (return 404 to hide existence)
  if (isInternalEndpoint(req.path)) {
    return res.status(404).json({ error: 'Not found' });
  }
  
  // Extract token from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const token = authHeader.substring(7);
  
  // Validate and lookup token
  const tokenData = await validateToken(token);
  if (!tokenData || tokenData.status !== 'active') {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  
  // Attach account info to request
  req.user = {
    accountId: tokenData.account_id,
    tokenId: tokenData.id
  };
  
  // Update last_used_at
  await updateTokenLastUsed(tokenData.id);
  
  // Track usage (optional, async)
  trackTokenUsage(tokenData.id, req.path, req.method).catch(console.error);
  
  next();
};
```

---

### Phase 4: Documentation

#### 4.1 Public API Documentation Structure

**File**: `API_DOCUMENTATION.md` or separate files per category

**Sections**:
1. **Getting Started**
   - Registration process
   - Obtaining API token
   - Authentication header format
   - Base URL

2. **Authentication**
   - How to use tokens
   - Token format
   - Error responses
   - Best practices

3. **Endpoints by Category**
   - Transactions API
   - Blocks API
   - Claims API
   - Proof Submissions API
   - Validator Performance API
   - Services API
   - Network Growth API
   - etc.

4. **Rate Limiting** (future)
5. **Error Handling**
6. **Code Examples**
   - cURL examples
   - JavaScript/TypeScript examples
   - Python examples

#### 4.2 Documentation Format

- Use OpenAPI/Swagger format (optional, future)
- Provide clear examples for each endpoint
- Include request/response schemas
- Document error codes
- Include rate limit information

---

## Implementation Checklist

### Database & Schema
- [ ] Create migration for `api_accounts` table
- [ ] Create migration for `api_tokens` table
- [ ] Create migration for `api_token_usage` table (optional)
- [ ] Add indexes for performance
- [ ] Create database service layer (`server/services/authService.js`)

### Authentication Middleware
- [ ] Create `server/middleware/auth.js`
- [ ] Implement token extraction from headers
- [ ] Implement token validation logic
- [ ] Implement token hash comparison
- [ ] Add usage tracking (optional)
- [ ] Add rate limiting (future)

### Account Management Endpoints
- [ ] POST `/api/v1/auth/register` - Registration
- [ ] POST `/api/v1/auth/login` - Login (password-based)
- [ ] POST `/api/v1/auth/request-tokens` - Request tokens via email (passwordless)
- [ ] GET `/api/v1/auth/account` - Get account info
- [ ] GET `/api/v1/auth/tokens` - List tokens
- [ ] POST `/api/v1/auth/tokens` - Create token
- [ ] DELETE `/api/v1/auth/tokens/:token_id` - Revoke token
- [ ] POST `/api/v1/auth/tokens/:token_id/regenerate` - Regenerate token
- [ ] POST `/api/v1/auth/verify-email` - Verify email address
- [ ] POST `/api/v1/auth/resend-verification` - Resend verification email

### Endpoint Protection
- [ ] Create endpoint categorization document
- [ ] Apply auth middleware to API server
- [ ] Whitelist public endpoints
- [ ] Protect token-based endpoints
- [ ] Hide internal endpoints (return 404)

### Documentation
- [ ] Create endpoint listing document for categorization
- [ ] Create public API documentation
- [ ] Add authentication examples
- [ ] Document error responses
- [ ] Add code examples

### Testing
- [ ] Unit tests for token generation
- [ ] Unit tests for token validation
- [ ] Integration tests for registration
- [ ] Integration tests for token management
- [ ] Integration tests for protected endpoints
- [ ] Test error cases (invalid token, expired token, etc.)

### Security
- [ ] Ensure tokens are hashed before storage
- [ ] Implement secure random token generation
- [ ] Add rate limiting (future)
- [ ] Add CORS configuration for API endpoints
- [ ] Add request logging for security auditing

---

## Security Considerations

### Token Security
1. **Never log full tokens** - Only log token prefixes
2. **HTTPS only** - Enforce HTTPS in production
3. **Token rotation** - Encourage users to rotate tokens periodically
4. **Token expiration** - Support optional token expiration
5. **Revocation** - Immediate token revocation capability

### Account Security
1. **Email validation** - Verify email format and uniqueness
2. **Rate limiting** - Prevent abuse of registration endpoint
3. **Account status** - Support account suspension
4. **Audit logging** - Log all account and token operations

### API Security
1. **Input validation** - Validate all inputs
2. **SQL injection prevention** - Use parameterized queries
3. **CORS configuration** - Restrict CORS appropriately
4. **Error messages** - Don't leak sensitive information in errors

---

## Future Enhancements

### Payment Integration
- Add payment tier to `api_accounts.metadata`
- Add rate limiting based on tier
- Add usage quotas based on tier
- Add billing endpoints

### Advanced Features
- OAuth2 support
- API key scopes/permissions
- Webhook support
- Usage analytics dashboard
- Token rotation reminders

### Monitoring
- Token usage analytics
- Endpoint usage statistics
- Error rate monitoring
- Performance monitoring per token

---

## Migration Strategy

### Phase 1: Preparation (No Breaking Changes)
1. Create database schema
2. Create account management endpoints
3. Create authentication middleware (not applied yet)
4. Test registration and token generation

### Phase 2: Soft Launch
1. Apply authentication to new endpoints only
2. Keep existing endpoints public (backward compatible)
3. Announce token-based access as "beta"

### Phase 3: Gradual Migration
1. Add authentication to high-traffic endpoints
2. Monitor usage and errors
3. Provide migration guide for users

### Phase 4: Full Migration
1. Apply authentication to all token-based endpoints
2. Update documentation
3. Deprecate public access (with notice period)

---

## Timeline Estimate

- **Phase 1 (Database & Core)**: 2-3 days
- **Phase 2 (Account Management)**: 2-3 days
- **Phase 3 (Endpoint Protection)**: 2-3 days
- **Phase 4 (Documentation)**: 1-2 days
- **Testing & Refinement**: 2-3 days

**Total**: ~10-14 days

---

## Next Steps

1. **Review and approve this plan**
2. **Categorize endpoints** (see `ENDPOINT_CATEGORIZATION.md`)
3. **Create database migrations**
4. **Implement core authentication**
5. **Build account management endpoints**
6. **Apply protection to endpoints**
7. **Create documentation**

---

## Authentication Models

We have two options for user authentication:

### Option 1: Password-Based Login (Recommended for Full Control)

**Flow**:
1. User registers with email + password
2. User receives API token on registration
3. User can login with email + password to:
   - View account information
   - List their tokens (prefixes only)
   - Create new tokens
   - Revoke tokens
4. Full tokens are only shown once (on creation/regeneration)

**Pros**:
- Users have full control over their account
- Can access account from any device with password
- More traditional and familiar UX
- Better security (password + token)

**Cons**:
- Requires password management
- Need password reset functionality
- More complex implementation

### Option 2: Passwordless (Email-Based Token Retrieval)

**Flow**:
1. User registers with email only
2. User receives API token on registration
3. If user loses token, they request token retrieval via email
4. System sends email with token information or temporary access link
5. User can then view/manage tokens

**Pros**:
- Simpler for users (no password to remember)
- Less security surface (no password to compromise)
- Easier implementation (no password hashing)

**Cons**:
- Relies on email security
- Users must have access to email to retrieve tokens
- Less control if email is compromised

### Recommended Approach: Hybrid (Both Options)

Allow users to choose:
- **Passwordless by default**: Simple registration, email-based token retrieval
- **Optional password**: Users can add password later for additional security
- **Password reset**: If password is set, support password reset

## Questions to Resolve

1. **Token Format**: Confirm `pk_live_` prefix is acceptable
2. **Authentication Model**: Password-based, passwordless, or hybrid?
3. **Email Verification**: Should we verify emails or allow any email?
4. **Rate Limiting**: What limits should we set initially?
5. **Token Expiration**: Should tokens expire by default or be permanent?
6. **Internal Endpoints**: Should internal endpoints return 404 or 403?
7. **Documentation Hosting**: Where will public documentation be hosted?
8. **Token Retrieval**: Should we email full tokens or temporary access links?

