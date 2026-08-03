# Operations Notes

## Metrics

- `GET /metrics` exposes Prometheus-compatible metrics.
- In production, set `METRICS_TOKEN` and send it as `x-metrics-token`.
- Example scrape config: `docs/prometheus-scrape.yml`.
- Example alert rules: `docs/prometheus-alert-rules.yml`.
- A runnable local monitoring stack is provided in `docs/docker-compose.monitoring.yml` with `docs/prometheus.yml`.
- Key metrics added in Phase 3:
  - `emar_http_request_errors_total`
  - `emar_http_request_duration_ms`
  - `emar_login_failures_total`
  - `emar_mar_write_failures_total`

## Health checks

- `GET /healthz` returns process liveness.
- `GET /readyz` verifies MongoDB connectivity, upload storage readiness, and transaction capability when `REQUIRE_DB_TRANSACTIONS=true`.

## Suggested alert rules

- Alert on elevated `emar_http_request_errors_total` over a 5-minute rate window.
- Alert on p95 `emar_http_request_duration_ms` above service targets.
- Alert on sustained increases in `emar_login_failures_total`.
- Alert on any non-zero `emar_mar_write_failures_total` over an operationally relevant window.

## Deployment hardening follow-up

- Use `backend/.env.staging.example` and `backend/.env.production.example` as separate non-local templates.
- The backend now fails fast in non-development environments when placeholder config values are left in place.
- Use separate environment variables, object-storage buckets, and MongoDB clusters for staging and production.
- Prefer managed MongoDB with scheduled backups and periodic restore drills.
- Keep `STORAGE_DRIVER=s3` in non-local environments and configure bucket/region/credentials.
- Set `REQUIRE_DB_TRANSACTIONS=true` on managed Mongo deployments so medication and MAR audit writes fail closed if transactions are unavailable.