# What We Want to Do

## Problem Statement

We are operating a blockchain indexer with **~1.5TB+ of transactional data spanning ~2 years**, stored in PostgreSQL. The continuous growth of this dataset is putting pressure on:

* Query latency for recent data
* Storage costs
* Operational complexity (vacuuming, indexing, backups)

The current setup treats **all historical data equally**, even though real usage is heavily skewed toward **recent activity**.

---

## Core Goal

Design and operate a **data lifecycle architecture** where:

* **Recent data (last 3 months)** is:

  * Always online
  * Fully indexed
  * Queryable in **milliseconds**
  * Optimized for API and explorer workloads

* **Older data (beyond 3 months)** is:

  * Moved out of the hot path
  * Cheap to store
  * Allowed to be slower to access
  * Still retrievable when explicitly needed

This must be achieved **without breaking the indexer**, **without frequent downtime**, and in a way that can scale for **many more years of chain history**.

---

## Key Principles

1. **Time-aware data lifecycle**
   Data must age out of the hot database automatically and predictably.

2. **Hot path protection**
   Queries for recent blocks must never scan or compete with historical data.

3. **Operational safety**
   No row-by-row deletes, no long locks, no risky maintenance operations.

4. **Explicit separation of concerns**

   * Hot data → performance
   * Cold data → cost efficiency

5. **Indexer continuity**
   The indexer should continue ingesting new blocks without being aware of cold storage mechanics.

---

## What the System Should Look Like (Conceptually)

* The database is **partitioned by time** (e.g., monthly).
* Only the **last 3 months of partitions** are attached to the hot production database.
* Older partitions are **detached** and moved to a cold storage layer.
* Applications **explicitly choose** where to query:

  * Hot DB for recent data
  * Cold storage for historical data

---

## What We Are NOT Trying to Do

* We are not trying to make all 2+ years of data queryable at millisecond latency.
* We are not trying to keep the entire chain history in a single production database forever.
* We are not trying to optimize analytics and APIs in the same storage layer.

---

## Success Criteria

This initiative is successful if:

* Hot database size stays **bounded and predictable**
* Recent queries remain consistently fast as total history grows
* Old data can be archived or restored without operational risk
* Storage and compute costs grow **sub-linearly** with chain age
* The system can realistically scale to **5–10+ years of data**

---

## Why This Matters

This is not a one-time optimization — it is **foundational infrastructure work**.

Getting this right:

* Unlocks long-term scalability
* Reduces future re-architecture risk
* Keeps the indexer reliable under sustained growth

In short:

> **We want time to work in our favor, not against us.**
