WITH bounds AS (
        SELECT ((NOW() AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date) AS end_day,
               ((NOW() AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date - (7 - 1) * INTERVAL '1 day')::date AS start_day
      ),
      days AS (
        SELECT generate_series(b.start_day, b.end_day, INTERVAL '1 day')::date AS day
        FROM bounds b
      ),
      block_days AS (
        SELECT
          height,
          chain,
          DATE_TRUNC('day', timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date AS day
        FROM blocks
        WHERE timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' >= (SELECT start_day FROM bounds)
      ),
      proof_events_agg AS (
        SELECT
          bd.day,
          SUM(pe.num_relays) AS relays,
          SUM(pe.num_claimed_compute_units) AS claimed_compute_units,
          SUM(pe.num_estimated_compute_units) AS estimated_compute_units,
          COALESCE(SUM(
            CASE
              WHEN pe.num_claimed_compute_units > 0
                THEN pe.num_relays * (pe.num_estimated_compute_units::numeric / pe.num_claimed_compute_units::numeric)
              ELSE pe.num_relays
            END
          ), 0)                                   AS estimated_relays
        FROM proof_events pe
        INNER JOIN block_days bd ON pe.block_height = bd.height AND pe.chain = bd.chain
        WHERE pe.event_type IN ('created', 'submitted')
          AND (pe.chain = 'pocket-mainnet')
        GROUP BY bd.day
      )
      SELECT
        d.day,
        COALESCE(p.relays, 0) AS relays,
        COALESCE(p.claimed_compute_units, 0) AS claimed_compute_units,
        COALESCE(p.estimated_compute_units, 0) AS estimated_compute_units,
        COALESCE(p.estimated_relays, 0)        AS estimated_relays
      FROM days d
      LEFT JOIN proof_events_agg p USING(day)
      ORDER BY d.day ASC;