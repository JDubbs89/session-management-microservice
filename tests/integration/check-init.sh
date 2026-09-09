#!/usr/bin/env bash
# Runs inside a disposable PostgreSQL container after the normal init test.
set -euo pipefail
: "${POSTGRES_USER:?}"
: "${POSTGRES_DB:?}"
createdb -U "$POSTGRES_USER" init_failure_probe
# Inject an invalid SQL call after ON_ERROR_STOP, before any tables are created.
sed '2iSELECT deliberately_missing_init_function();' /docker-entrypoint-initdb.d/init.sql > /tmp/bad-init.sql
if psql -U "$POSTGRES_USER" -d init_failure_probe -f /tmp/bad-init.sql > /tmp/init-failure.log 2>&1; then
    echo 'Invalid initialization unexpectedly succeeded' >&2
    exit 1
fi
if ! grep -q 'deliberately_missing_init_function' /tmp/init-failure.log; then
    cat /tmp/init-failure.log >&2
    exit 1
fi
test "$(psql -At -U "$POSTGRES_USER" -d init_failure_probe -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")" = 0
dropdb -U "$POSTGRES_USER" init_failure_probe
echo 'Initialization stops visibly on SQL errors.'
