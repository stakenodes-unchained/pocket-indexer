#!/usr/bin/env bash
set -euo pipefail

PGDATA="${PGDATA:-/var/lib/postgresql/data/pgdata}"
PRIMARY_DB_HOST="${PRIMARY_DB_HOST:?PRIMARY_DB_HOST is required}"
PRIMARY_DB_PORT="${PRIMARY_DB_PORT:-5432}"
PRIMARY_DB_REPL_USER="${PRIMARY_DB_REPL_USER:?PRIMARY_DB_REPL_USER is required}"
PRIMARY_DB_REPL_PASSWORD="${PRIMARY_DB_REPL_PASSWORD:?PRIMARY_DB_REPL_PASSWORD is required}"
REPLICA_APP_NAME="${REPLICA_APP_NAME:-pocket_indexer_api_node}"
PRIMARY_DB_SSLMODE="${PRIMARY_DB_SSLMODE:-prefer}"
REPLICA_SLOT_NAME="${REPLICA_SLOT_NAME:-}"

mkdir -p "${PGDATA}"
chmod 700 "${PGDATA}" || true

if [ ! -f "${PGDATA}/PG_VERSION" ]; then
  echo "[replica-bootstrap] No PGDATA found, cloning from primary..."
  rm -rf "${PGDATA:?}/"*

  export PGPASSWORD="${PRIMARY_DB_REPL_PASSWORD}"
  export PGSSLMODE="${PRIMARY_DB_SSLMODE}"
  until pg_basebackup \
    -h "${PRIMARY_DB_HOST}" \
    -p "${PRIMARY_DB_PORT}" \
    -U "${PRIMARY_DB_REPL_USER}" \
    -D "${PGDATA}" \
    -Fp \
    -Xs \
    -P \
    -R
  do
    echo "[replica-bootstrap] pg_basebackup failed, retrying in 5 seconds..."
    sleep 5
  done

  {
    echo "primary_conninfo = 'host=${PRIMARY_DB_HOST} port=${PRIMARY_DB_PORT} user=${PRIMARY_DB_REPL_USER} password=${PRIMARY_DB_REPL_PASSWORD} application_name=${REPLICA_APP_NAME} sslmode=${PRIMARY_DB_SSLMODE}'"
    if [ -n "${REPLICA_SLOT_NAME}" ]; then
      echo "primary_slot_name = '${REPLICA_SLOT_NAME}'"
    fi
    echo "hot_standby = on"
    echo "default_transaction_read_only = on"
  } >> "${PGDATA}/postgresql.auto.conf"

  touch "${PGDATA}/standby.signal"
  echo "[replica-bootstrap] Base backup complete."
else
  echo "[replica-bootstrap] Existing PGDATA found, starting as replica."
fi

POSTGRES_ARGS=(
  -D "${PGDATA}"
  -c hot_standby=on
  -c default_transaction_read_only=on
)

# Official postgres image starts as root and drops privileges in entrypoint.
# Since we run a custom script, we must drop privileges explicitly before
# starting the postgres server process.
if [ "$(id -u)" = "0" ]; then
  chown -R postgres:postgres "${PGDATA}"
  chmod 700 "${PGDATA}" || true

  if command -v gosu >/dev/null 2>&1; then
    exec gosu postgres postgres "${POSTGRES_ARGS[@]}"
  elif command -v su-exec >/dev/null 2>&1; then
    exec su-exec postgres postgres "${POSTGRES_ARGS[@]}"
  else
    echo "[replica-bootstrap] ERROR: running as root and no gosu/su-exec found."
    exit 1
  fi
fi

exec postgres "${POSTGRES_ARGS[@]}"
