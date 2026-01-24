# Network Growth API Migration Guide

## Summary

The Network Growth APIs have been updated to use the `proof_events` table instead of `claim_settlements` and `proof_submissions` tables for calculating relays and compute units. This change simplifies the API response and improves performance.

**Date:** January 20, 2026

**Affected Endpoints:**
- `GET /api/v1/network-growth/performance`
- `GET /api/v1/network-growth/summary`
- `GET /api/v1/network-growth`

## What Changed

### Data Source
- **Before:** Performance metrics were calculated from `claim_settlements` and `proof_submissions` tables
- **After:** Performance metrics are now calculated from `proof_events` table (filtered by `event_type = 'created'`)

### Response Field Changes

#### 1. `/api/v1/network-growth/performance`

**Removed Fields:**
- `proof_submissions_computed_units`
- `proof_submissions_estimated_units`
- `settled_claims_computed_units`
- `settled_claims_estimated_units`
- `compute_units` (renamed)

**New/Updated Fields:**
- `claimed_compute_units` (replaces `compute_units`)
- `estimated_compute_units` (new)

**Before:**
```json
{
  "data": {
    "window_days": 7,
    "timeline": [
      {
        "day": "2025-11-01",
        "relays": 1234567890,
        "compute_units": 126000000000,
        "proof_submissions_computed_units": 120000000000,
        "proof_submissions_estimated_units": 125000000000,
        "settled_claims_computed_units": 6000000000,
        "settled_claims_estimated_units": 6100000000
      }
    ]
  }
}
```

**After:**
```json
{
  "data": {
    "window_days": 7,
    "timeline": [
      {
        "day": "2025-11-01",
        "relays": 1234567890,
        "claimed_compute_units": 120000000000,
        "estimated_compute_units": 125000000000
      }
    ]
  }
}
```

#### 2. `/api/v1/network-growth/summary`

**Removed Fields:**
- `compute_units` (renamed)

**New/Updated Fields:**
- `claimed_compute_units` (replaces `compute_units`)
- `estimated_compute_units` (new)

**Before:**
```json
{
  "data": {
    "window_days": 7,
    "applications": 10,
    "suppliers": 5,
    "gateways": 3,
    "services": 4,
    "relays": 654321,
    "compute_units": 210987
  }
}
```

**After:**
```json
{
  "data": {
    "window_days": 7,
    "applications": 10,
    "suppliers": 5,
    "gateways": 3,
    "services": 4,
    "relays": 654321,
    "claimed_compute_units": 120000000000,
    "estimated_compute_units": 125000000000
  }
}
```

#### 3. `/api/v1/network-growth` (Combined)

**Removed Fields:**
- `compute_units` (renamed)

**New/Updated Fields:**
- `claimed_compute_units` (replaces `compute_units`)
- `estimated_compute_units` (new)

**Before:**
```json
{
  "data": {
    "window_days": 7,
    "timeline": [
      {
        "day": "2025-11-01",
        "applications": 2,
        "suppliers": 1,
        "gateways": 0,
        "services": 1,
        "relays": 123456,
        "compute_units": 789012
      }
    ]
  }
}
```

**After:**
```json
{
  "data": {
    "window_days": 7,
    "timeline": [
      {
        "day": "2025-11-01",
        "applications": 2,
        "suppliers": 1,
        "gateways": 0,
        "services": 1,
        "relays": 123456,
        "claimed_compute_units": 120000000000,
        "estimated_compute_units": 125000000000
      }
    ]
  }
}
```

## Frontend Migration Guide

### Step 1: Update Field References

Replace all references to the old field names with the new ones:

```javascript
// Before
const computeUnits = data.compute_units;
const proofSubmissionsComputed = data.proof_submissions_computed_units;
const proofSubmissionsEstimated = data.proof_submissions_estimated_units;
const settledClaimsComputed = data.settled_claims_computed_units;
const settledClaimsEstimated = data.settled_claims_estimated_units;

// After
const claimedComputeUnits = data.claimed_compute_units;
const estimatedComputeUnits = data.estimated_compute_units;
```

### Step 2: Update Chart and Display Logic

If your frontend displays separate metrics for proof submissions and settled claims, you'll need to update the logic:

```javascript
// Before - multiple compute unit metrics
const chartData = {
  proofSubmissions: data.proof_submissions_computed_units,
  settledClaims: data.settled_claims_computed_units,
  total: data.compute_units
};

// After - simplified compute unit metrics
const chartData = {
  claimed: data.claimed_compute_units,
  estimated: data.estimated_compute_units
};
```

### Step 3: Update Type Definitions (TypeScript)

If you're using TypeScript, update your interface definitions:

```typescript
// Before
interface NetworkGrowthPerformance {
  day: string;
  relays: number;
  compute_units: number;
  proof_submissions_computed_units: number;
  proof_submissions_estimated_units: number;
  settled_claims_computed_units: number;
  settled_claims_estimated_units: number;
}

// After
interface NetworkGrowthPerformance {
  day: string;
  relays: number;
  claimed_compute_units: number;
  estimated_compute_units: number;
}
```

```typescript
// Before
interface NetworkGrowthSummary {
  window_days: number;
  applications: number;
  suppliers: number;
  gateways: number;
  services: number;
  relays: number;
  compute_units: number;
}

// After
interface NetworkGrowthSummary {
  window_days: number;
  applications: number;
  suppliers: number;
  gateways: number;
  services: number;
  relays: number;
  claimed_compute_units: number;
  estimated_compute_units: number;
}
```

### Step 4: Update Backward Compatibility (Optional)

If you need to support both old and new API responses temporarily, you can add a compatibility layer:

```javascript
function normalizeNetworkGrowthResponse(data) {
  return {
    ...data,
    // Map old field names to new ones if they don't exist
    claimed_compute_units: data.claimed_compute_units || data.compute_units || 0,
    estimated_compute_units: data.estimated_compute_units || data.compute_units || 0
  };
}

// Usage
const response = await fetch('/api/v1/network-growth/performance');
const json = await response.json();
const normalizedData = normalizeNetworkGrowthResponse(json.data);
```

## Benefits of This Change

1. **Simplified Response:** Fewer fields to process and display
2. **Better Performance:** Single table query instead of multiple joins
3. **More Accurate Data:** Direct access to proof events data
4. **Clearer Semantics:** Distinction between claimed and estimated compute units is now explicit

## Testing Recommendations

1. **Verify API Responses:** Test all three endpoints with different window sizes and chain filters
2. **Check Data Continuity:** Ensure historical data matches expected values
3. **Update Tests:** Update any automated tests that check API response structure
4. **Visual Regression Testing:** Compare charts/graphs before and after the change

## Rollback Plan

If you need to rollback to the old behavior:

1. The SQL queries in the original implementation are preserved in git history
2. Search for commit message containing "Network Growth API Migration" to find the changes
3. Revert the changes to `server/api-server.js` and `NETWORK_GROWTH_API.md`

## Additional Changes (January 24, 2026)

### Rolling Time Windows for Summary Endpoint

The `/api/v1/network-growth/summary` endpoint now uses **rolling time windows** instead of calendar day boundaries for performance metrics.

**What Changed:**
- **Before:** `window=1` returned data from midnight (America/New_York timezone) of the current day to now
- **After:** `window=1` returns data from NOW - 24 hours to NOW (true rolling 24-hour window)

**Impact:**
- More accurate representation of "last N days" of activity
- Consistent with how entity metrics were already calculated
- `window=1` now truly means "last 24 hours" rather than "today's calendar day so far"

**Example:**
If you query at 2:00 PM on January 24:
- **Old behavior:** Data from 12:00 AM Jan 24 to 2:00 PM Jan 24 (14 hours)
- **New behavior:** Data from 2:00 PM Jan 23 to 2:00 PM Jan 24 (24 hours)

This change makes the API more intuitive and consistent.

## Support

For questions or issues related to this migration:

1. Check the updated documentation: `NETWORK_GROWTH_API.md`
2. Review the SQL query reference: `server/scripts/CU_and_relays_for_network_growth.sql`
3. Contact the backend team for data discrepancy issues

## Related Files

- `server/api-server.js` - API endpoint implementations
- `NETWORK_GROWTH_API.md` - Updated API documentation
- `server/scripts/CU_and_relays_for_network_growth.sql` - Reference SQL query

