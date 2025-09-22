Dashboard Implementation Tracker

Purpose
- Central log of tasks, status, progress, and next steps for the Indexer Dashboard (monitoring and control).
- Hand-off friendly: your client can see scope, progress, and what remains.

Scope (high-level)
- Monitor chains: processed height vs latest height, lag, tx/sec, error rates, entity counts, last updated.
- Monitor workers and RPC health: heartbeats, latency, error rates.
- Controls: start/stop sync, reprocess range, rebuild entities, backfill delegations, reconciliation.
- Jobs and audit: queue/history, outcomes, metrics, logs.
- Secure: token-based auth; roles: viewer/operator.

Milestones and Status
1) Define dashboard scope and KPIs
   - Status: Completed
   - Notes: KPIs listed; implemented overview and chain detail metrics.

2) Database migrations for jobs and metrics
   - Status: Completed
   - Deliverables:
     - jobs(id, type, params JSONB, status, created_by, created_at, started_at, finished_at, error)
     - job_runs(id, job_id, status, metrics JSONB, logs_url, started_at, finished_at, error)
     - metrics_snapshots(chain, ts, processed_height, latest_height, tx_rate, error_rate, apps, suppliers, gateways, services)
     - worker_heartbeats(worker_id, last_seen, meta JSONB)

3) Job runner service
   - Status: Pending
   - Notes: Executes queued jobs (sync/reconcile/reprocess-range) with concurrency caps and safety checks.

4) Control endpoints (API)
   - Status: Pending
   - Endpoints:
     - POST /api/v1/jobs (types: sync_start, sync_stop, reprocess_range, rebuild_entities, backfill_delegations)
     - POST /api/v1/jobs/:id/cancel

5) Metrics endpoints (API)
   - Status: Completed
   - Endpoints:
     - GET /api/v1/metrics/chains (overview)
     - GET /api/v1/metrics/chains/:chain (detail + history window)

6) Health endpoints (API)
   - Status: Completed
   - Endpoints:
     - GET /api/v1/health/workers
     - GET /api/v1/health/rpc

7) Processor instrumentation
   - Status: In Progress
   - Notes: Metrics collector added; next emit richer run-time stats and job metrics.

8) Frontend dashboard (Next.js)
   - Status: In Progress
   - Pages:
     - Chains overview (cards with lag colors and quick stats) [Done]
     - Chain detail (lag chart, top apps/suppliers, recent staking) [Initial]
     - Add filters (search, status, pagination) [Next]
     - Add jobs and health pages [Later]
     - Jobs (create, queue/history, statuses)
     - Health (workers + RPC)

9) Realtime updates
   - Status: Pending
   - Notes: WebSocket or Server-Sent Events to stream job updates and key metrics.

10) Auth & RBAC
   - Status: Pending
   - Notes: API token or OAuth; viewer vs operator.

11) Alerts & notifications
   - Status: Pending
   - Notes: Thresholds on lag/errors; email/webhook integration.

12) Packaging & docs
   - Status: Pending
   - Notes: Docker compose, env templates, runbook, hand-off guide.

What’s already implemented (backend foundation)
- Entities parsing extended to include stake_denom, service_configs, delegations; persistence added.
- New REST endpoints for: applications, suppliers, gateways, delegations.
- Production data processor now persists final state and logs upsert summaries.
- Metrics collector service and metrics endpoints.
- Staking events endpoint with filters.

Immediate Next Steps
1) Frontend: add filters and pagination to Chain detail (apps/suppliers/staking).
2) Frontend: add sorting and status filters; show gateways list.
3) Backend: add pagination params to metrics endpoints (history window already supports limit).
4) Backend: scaffold jobs API and minimal runner for sync start/stop and reprocess-range.

Risk/Notes
- Ensure control endpoints are protected (token-based) before exposing to client.
- Reconciliation jobs must run in read-only or batched mode to avoid DB contention with live indexer.

Progress Log
- 2025-09-22: Extended parsers and persistence; added entity APIs; added final-state persistence and logging.

Session Management
- If chat context becomes large, summarize state as of the latest Progress Log, and continue work referencing this file as the ground truth tracker.


