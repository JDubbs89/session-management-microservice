# Local release and load probes

Run these only against a migrated, disposable PostgreSQL database and a live API connected to that same database. Set `INTEGRATION_TEST_DATABASE=1`, `DATABASE_URL`, `SECRET_KEY`, `INTEGRATION_ADMIN_PASSWORD`, and `SESSION_API_URL` as in the integration workflow. Seed `integration-admin` with `tests/integration/seed_admin.py`. Use the locked Python 3.12 test environment (`pip install --require-hashes -r src/requirements-test.txt`), and run:

```bash
python tests/integration/release.py
python tests/integration/load.py > /tmp/session-load-report.json
```

The release probe supplements the all-route, service and identity suites with expired, malformed, missing, incorrectly signed, role-forged and version-revoked JWTs; ordinary-user admin denial; duplicate username/external identity conflicts; and refusal to bootstrap another administrator. The bootstrap check runs the real CLI in a subprocess against PostgreSQL, substituting only its interactive password prompts. It does not simulate database responses.

The load probe uses eight workers and at most 16 HTTP connections. Twelve distinct players race for four seats: exactly four must join and eight must receive capacity conflicts. Forty discovery requests then rotate across four service identities behind one client IP; all must succeed. It reports request count, workers, p50/p95 latency, status counts and unexpected errors as JSON on stdout, without credentials. Each invocation uses a unique tenant and removes its own test entities even on failure.

The local regression targets are **HTTP p95 below 2,000 ms** and **zero unexpected transport/server/status errors**. Capacity conflicts in the join race are expected. These generous, small-sample targets detect broken authorization, serial bottlenecks and oversubscription; they do not establish production capacity, an SLO, or sustained throughput. Run on an otherwise quiet host. A failure should trigger inspection of API logs, PostgreSQL locks and pool metrics before changing thresholds.

A separate real-database probe deliberately constrains a SQLAlchemy client pool to two connections, zero overflow and a 100 ms acquisition timeout. Eight simultaneous tasks hold acquired connections for 350 ms. Exactly two must complete and six must time out, followed by a successful recovery query. This verifies predictable bounded queueing in the isolated probe pool. It does **not** saturate or characterize the API process's own pool; API pool capacity under a sustained workload remains a deployment-specific measurement.

For comparable results, record machine/CPU, PostgreSQL/API versions, worker count, database/network placement and whether rate limiting uses PostgreSQL. Keep rate limits enabled: the probe deliberately stays below normal service budgets and never disables protection. Run once per isolated environment or allow budgets from previous suites to clear. Anonymous login may need one short retry because integration suites share an IP.

Production capacity work still requires a representative traffic mix, larger user populations, multiple API/game workers, sustained runs, reconnect storms, network latency, realistic metadata and database sizes. Report websocket latency separately from directory HTTP latency. Do not infer supported player counts from these bounded checks.
