/**
 * pg Pool emits 'error' on idle clients when the server terminates a connection
 * (e.g. replica hot-standby conflict). Log 40001 at warn with context instead of raw error spam.
 */
function registerPoolIdleErrorHandler(pool, kind) {
  pool.on('error', (err) => {
    if (err && err.code === '40001') {
      console.warn(
        `[pg ${kind}] idle connection closed: replica hot-standby conflict (40001). ` +
          'Tune replica: hot_standby_feedback=on, max_standby_streaming_delay=-1 (see server/API_NODE_SETUP.md).'
      );
      return;
    }
    console.error(`Unexpected error on idle PostgreSQL ${kind} client`, err);
  });
}

module.exports = { registerPoolIdleErrorHandler };
