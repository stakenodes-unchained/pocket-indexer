# Authentication Flow Explanation

## The Problem

After registration, users receive an API token. But what happens when they:
- Lose their token
- Want to access their account from a new device
- Need to view their tokens
- Want to create additional tokens

## Solution: Two Authentication Models

We've designed a flexible system that supports both password-based and passwordless authentication.

---

## Option 1: Password-Based Login (Recommended)

### Flow Diagram

```
Registration
    ↓
User provides: email + password
    ↓
Account created + API token generated
    ↓
User receives token (shown once)
    ↓
[User loses token or wants to access account]
    ↓
Login with email + password
    ↓
Access account: view tokens, create new tokens, manage account
```

### Endpoints

1. **POST** `/api/v1/auth/register`
   - Register with email + password
   - Returns account + API token

2. **POST** `/api/v1/auth/login`
   - Login with email + password
   - Returns account info + list of token prefixes (not full tokens)
   - Updates `last_login_at`

3. **GET** `/api/v1/auth/tokens` (requires token)
   - List all tokens for account
   - Shows token prefixes, names, status, last_used_at
   - Does NOT show full tokens (security)

4. **POST** `/api/v1/auth/tokens` (requires token)
   - Create new token
   - Returns full token (shown once)

### Example Flow

```bash
# 1. Register
curl -X POST http://localhost:3006/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "secure_password",
    "name": "John Doe"
  }'

# Response includes full token:
# {
#   "data": {
#     "account": {...},
#     "token": {
#       "token": "pk_live_a1b2c3d4..." // Full token shown once
#     }
#   }
# }

# 2. User loses token, wants to login
curl -X POST http://localhost:3006/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "secure_password"
  }'

# Response shows token prefixes (not full tokens):
# {
#   "data": {
#     "account": {...},
#     "tokens": [
#       {
#         "id": 1,
#         "token_prefix": "pk_live_a1b2c3d4",
#         "name": "Default Token",
#         "status": "active",
#         "last_used_at": "2025-01-28T15:30:00Z"
#       }
#     ]
#   }
# }

# 3. User creates new token (using existing token for auth)
curl -X POST http://localhost:3006/api/v1/auth/tokens \
  -H "Authorization: Bearer pk_live_existing_token..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production Token"
  }'

# Response includes new full token (shown once)
```

### Pros
- ✅ Users have full control over their account
- ✅ Can access account from any device with password
- ✅ More traditional and familiar UX
- ✅ Better security (password + token)

### Cons
- ❌ Requires password management
- ❌ Need password reset functionality
- ❌ More complex implementation

---

## Option 2: Passwordless (Email-Based Token Retrieval)

### Flow Diagram

```
Registration
    ↓
User provides: email only
    ↓
Account created + API token generated
    ↓
User receives token (shown once)
    ↓
[User loses token]
    ↓
Request token retrieval via email
    ↓
System sends email with:
  - Temporary access link (expires in 15 minutes)
  - OR list of token prefixes
    ↓
User clicks link or checks email
    ↓
Access account: view tokens, create new tokens
```

### Endpoints

1. **POST** `/api/v1/auth/register`
   - Register with email only (no password)
   - Returns account + API token

2. **POST** `/api/v1/auth/request-tokens`
   - Request token information via email
   - Always returns same message (security: don't reveal if email exists)
   - Rate limited: max 3 requests per email per hour

3. **Email Link** (temporary access)
   - User clicks link from email
   - Gets temporary session token (expires in 15 minutes)
   - Can access account endpoints

4. **GET** `/api/v1/auth/tokens` (requires token or temporary session)
   - List all tokens for account

### Example Flow

```bash
# 1. Register (passwordless)
curl -X POST http://localhost:3006/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "name": "John Doe"
  }'

# Response includes full token:
# {
#   "data": {
#     "account": {...},
#     "token": {
#       "token": "pk_live_a1b2c3d4..." // Full token shown once
#     }
#   }
# }

# 2. User loses token, requests retrieval
curl -X POST http://localhost:3006/api/v1/auth/request-tokens \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }'

# Response (always same, for security):
# {
#   "message": "If an account exists with this email, we've sent your token information to your email address."
# }

# 3. User receives email with:
#    - Temporary access link: https://api.example.com/auth/temp-access?token=temp_token_123
#    - OR list of token prefixes

# 4. User clicks link or uses temporary token
curl -X GET http://localhost:3006/api/v1/auth/tokens \
  -H "Authorization: Bearer temp_token_123"

# Response shows token prefixes
```

### Pros
- ✅ Simpler for users (no password to remember)
- ✅ Less security surface (no password to compromise)
- ✅ Easier implementation (no password hashing)

### Cons
- ❌ Relies on email security
- ❌ Users must have access to email to retrieve tokens
- ❌ Less control if email is compromised

---

## Recommended Approach: Hybrid (Both Options)

Allow users to choose their preferred authentication method:

### Registration Options

1. **Passwordless Registration** (Default)
   ```json
   POST /api/v1/auth/register
   {
     "email": "user@example.com",
     "name": "John Doe"
   }
   ```

2. **Password-Based Registration**
   ```json
   POST /api/v1/auth/register
   {
     "email": "user@example.com",
     "password": "secure_password",
     "name": "John Doe"
   }
   ```

### Login Options

1. **Password Login** (if password is set)
   ```json
   POST /api/v1/auth/login
   {
     "email": "user@example.com",
     "password": "secure_password"
   }
   ```

2. **Email Token Retrieval** (if passwordless)
   ```json
   POST /api/v1/auth/request-tokens
   {
     "email": "user@example.com"
   }
   ```

3. **Add Password Later** (for passwordless accounts)
   ```json
   POST /api/v1/auth/set-password
   {
     "email": "user@example.com",
     "verification_token": "token_from_email",
     "password": "new_password"
   }
   ```

### Database Schema Support

The schema supports both:
- `password_hash` - NULL for passwordless, hashed password if set
- `email_verified` - Required for passwordless token retrieval
- `email_verification_token` - For email verification

---

## Security Considerations

### Password-Based
- Use bcrypt or argon2 for password hashing
- Implement password strength requirements
- Support password reset flow
- Rate limit login attempts

### Passwordless
- Require email verification
- Rate limit token retrieval requests
- Temporary access tokens expire quickly (15 minutes)
- Never reveal if email exists in system

### Both
- Never return full tokens after initial creation
- Show only token prefixes in listings
- Track token usage
- Support token revocation
- Log all authentication attempts

---

## Implementation Priority

### Phase 1: Basic Flow
1. ✅ Registration with password
2. ✅ Login with password
3. ✅ Token management (list, create, revoke)

### Phase 2: Passwordless
1. ⬜ Passwordless registration
2. ⬜ Email token retrieval
3. ⬜ Temporary access tokens

### Phase 3: Enhanced Features
1. ⬜ Password reset
2. ⬜ Email verification
3. ⬜ Add password to passwordless accounts
4. ⬜ Two-factor authentication (future)

---

## User Experience Flow

### Scenario 1: User Registers and Uses Token

```
1. Register → Get token
2. Save token securely
3. Use token for API calls
4. Never need to login (token is the credential)
```

### Scenario 2: User Loses Token

**With Password:**
```
1. Login with email + password
2. View token list (prefixes)
3. Create new token if needed
```

**Passwordless:**
```
1. Request token retrieval via email
2. Check email for token information
3. Use token or create new one
```

### Scenario 3: User Wants Multiple Tokens

```
1. Login (password) or use existing token
2. View current tokens
3. Create new token with custom name
4. Use different tokens for different purposes
```

---

## Summary

**For the initial implementation, we recommend:**

1. **Start with password-based login** (simpler, more control)
2. **Add passwordless option later** (if users request it)
3. **Always show token prefixes** in listings (never full tokens)
4. **Support token regeneration** (revoke old, create new)
5. **Implement rate limiting** on all auth endpoints

This gives users a clear path to:
- Register and get a token
- Login to manage their account
- View and manage their tokens
- Create additional tokens as needed

