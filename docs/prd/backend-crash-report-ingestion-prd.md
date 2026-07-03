# Marketing Backend Crash Report Ingestion PRD

| Field | Value |
|------|-------|
| Document version | v1.0 |
| Created date | 2026-07-03 |
| Status | Draft |
| Product area | Marketing backend service |
| Backend repository | `/home/robertzeng/project/marketing` |
| Related desktop PRD | `docs/prd/desktop-crash-logging-prd.md` |

## 1. Summary

The marketing backend should provide a secure, bounded crash-report ingestion API for AiFetchly desktop clients. The endpoint must accept sanitized crash reports from authenticated and anonymous desktop apps, reject oversized or malformed payloads, deduplicate repeated crashes, and store reports without filling backend disks or polluting normal backend logs.

The API should be designed as an untrusted public ingestion endpoint. Electron client secrets cannot be trusted because they can be extracted from packaged desktop apps.

## 2. Background

AiFetchly desktop needs a way to submit crash reports after app crashes. The backend service in `/home/robertzeng/project/marketing` uses Beego and currently logs through `github.com/beego/beego/v2/core/logs`. Existing backend logging is not a safe place for raw crash payloads because crash reports can be large, repeated, user-controlled, and potentially sensitive.

The backend must avoid these failure modes:

- attackers or broken clients fill local disks with crash uploads
- raw crash payloads appear in normal backend log files
- unauthenticated users submit unlimited reports
- reports contain secrets or private user data
- duplicate crash loops create millions of identical records
- backend operators cannot search crash groups by app version, platform, or stack fingerprint

## 3. Goals

1. Provide a crash-report ingestion endpoint for desktop app reports.
2. Accept authenticated reports when the user is logged in.
3. Accept anonymous reports with stricter rate limits.
4. Validate request schema and reject unknown or oversized data.
5. Redact sensitive values on the server even if the client already redacted them.
6. Deduplicate repeated crash reports by fingerprint.
7. Store raw payloads outside normal backend logs.
8. Enforce retention and storage budgets.
9. Provide basic query and review capability for operators or admins.

## 4. Non-Goals

1. Do not build a full APM or log analytics product.
2. Do not accept arbitrary log file uploads in the first release.
3. Do not trust a static desktop app secret as authentication.
4. Do not write raw crash payloads with `logs.Info`, `logs.Warn`, or `logs.Error`.
5. Do not expose crash data to normal users.
6. Do not store full scraped pages, email content, cookies, tokens, or AI prompt bodies.

## 5. Users

### 5.1 Desktop App Users

Users can submit reports after a crash without needing to manually find log files. Anonymous users should still be able to submit a report if the app crashes before login.

### 5.2 Support Team

Support can locate reports by report id, user id, install id, app version, platform, time range, or crash fingerprint.

### 5.3 Engineering Team

Engineers can group crashes by fingerprint, inspect sanitized stack traces, and see whether a crash increases after a release.

## 6. API Requirements

### FR-1 Ingestion Endpoint

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1 | Add `POST /api/crash-reports` or equivalent versioned route. | P0 |
| FR-1.2 | Accept JSON only. Reject other content types. | P0 |
| FR-1.3 | Request body limit must be enforced before JSON parsing. Recommended default: 256 KB. | P0 |
| FR-1.4 | Optional larger upload mode may allow up to 1 MB only for authenticated users and explicit desktop user consent. | P2 |
| FR-1.5 | Return only `{ "status": true, "reportId": "..." }` on success. | P0 |
| FR-1.6 | Return generic error messages on failure. Do not expose storage paths or parser internals. | P0 |

### FR-2 Authentication and Identity

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-2.1 | If `Authorization: Bearer ...` is present, validate it with existing user auth middleware or shared auth service. | P0 |
| FR-2.2 | If no auth is present, accept report as anonymous only if anonymous crash reporting is enabled. | P1 |
| FR-2.3 | Do not rely on a hardcoded desktop app secret. | P0 |
| FR-2.4 | Require `X-AiFetchly-Install-Id` or request body `installId`, validated as UUID or stable random id format. | P0 |
| FR-2.5 | Store user id when authenticated, but do not require it for anonymous reports. | P0 |

### FR-3 Schema Validation

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.1 | Define a strict server-side request schema. | P0 |
| FR-3.2 | Reject unknown top-level fields unless explicitly allowlisted. | P0 |
| FR-3.3 | Enforce max lengths for every string field. | P0 |
| FR-3.4 | Enforce max number of breadcrumbs and recent errors. | P0 |
| FR-3.5 | Reject deeply nested objects and arbitrary maps. | P0 |
| FR-3.6 | Validate enum values for process type, crash type, platform, and severity. | P0 |

Recommended limits:

| Field | Limit |
|-------|-------|
| Total body | 256 KB |
| `message` | 4 KB |
| `stack` | 32 KB |
| `breadcrumbs` | 100 entries |
| `recentErrors` | 50 entries |
| Single breadcrumb message | 1 KB |
| Metadata values | 1 KB |

### FR-4 Redaction

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1 | Redact tokens, cookies, authorization headers, API keys, passwords, and refresh tokens. | P0 |
| FR-4.2 | Redact known sensitive query parameters from URLs. | P0 |
| FR-4.3 | Redact email addresses or hash them when exact address is not needed. | P1 |
| FR-4.4 | Apply redaction before storage. | P0 |
| FR-4.5 | Apply redaction before any backend log line. | P0 |

### FR-5 Rate Limiting and Abuse Control

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-5.1 | Rate limit by IP address. | P0 |
| FR-5.2 | Rate limit by authenticated user id. | P0 |
| FR-5.3 | Rate limit by install id. | P0 |
| FR-5.4 | Rate limit by crash fingerprint. | P0 |
| FR-5.5 | Apply stricter limits for anonymous reports. | P0 |
| FR-5.6 | Return HTTP 429 with a generic response when rate limited. | P0 |

Recommended initial limits:

| Scope | Limit |
|-------|-------|
| IP | 10 reports per minute |
| Anonymous install id | 50 reports per day |
| Authenticated user | 100 reports per day |
| Same fingerprint | 20 full payloads per hour, then increment count only |

### FR-6 Deduplication

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-6.1 | Compute server-side crash fingerprint. | P0 |
| FR-6.2 | Fingerprint should use app version, process type, crash type, error name, normalized message, and top stack frames. | P0 |
| FR-6.3 | Store duplicate reports as counters after the full payload cap is reached. | P0 |
| FR-6.4 | Track first seen, last seen, count, affected app versions, platforms, and user count per fingerprint. | P1 |

### FR-7 Storage

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-7.1 | Do not store raw crash payloads in normal backend log files. | P0 |
| FR-7.2 | Store searchable metadata in database. | P0 |
| FR-7.3 | Store full sanitized payload in object storage where available. | P1 |
| FR-7.4 | If object storage is not available, store payload under a dedicated crash directory with a hard size budget. | P0 |
| FR-7.5 | Partition local files by date if local file storage is used. | P0 |
| FR-7.6 | Use atomic writes for local payload files. | P1 |

Preferred storage flow:

```text
POST /api/crash-reports
  -> body size limit
  -> auth or anonymous identity
  -> schema validation
  -> server redaction
  -> fingerprint
  -> rate limit and duplicate policy
  -> metadata row in DB
  -> sanitized payload in object storage
```

Local fallback:

```text
/var/lib/marketing/crash-reports/
  2026-07-03/
    cr_abc123.json
    cr_def456.json
```

### FR-8 Retention and Disk Safety

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-8.1 | Full sanitized payload retention should default to 30 days. | P0 |
| FR-8.2 | Aggregated fingerprint metadata retention should default to 180 days. | P1 |
| FR-8.3 | Local crash payload directory must have a max size budget. Recommended default: 5 GB. | P0 |
| FR-8.4 | Cleanup job must delete oldest full payloads first. | P0 |
| FR-8.5 | Ingestion must reject or metadata-only-store reports when storage is over budget. | P0 |
| FR-8.6 | Expose storage usage metrics for alerting. | P1 |

### FR-9 Operator Review

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-9.1 | Add admin-only list endpoint for crash groups or reports. | P2 |
| FR-9.2 | Filter by app version, platform, process type, crash type, fingerprint, and date range. | P2 |
| FR-9.3 | Show sanitized payload only to admin users. | P2 |
| FR-9.4 | Provide report id lookup for support. | P2 |

## 7. Data Model

### 7.1 Crash Report Metadata

Suggested table: `crash_report`

| Field | Type | Notes |
|-------|------|-------|
| `id` | bigint or uuid | Internal primary key |
| `report_id` | string | Public report id returned to client |
| `fingerprint` | string | Server-computed crash group id |
| `user_id` | bigint nullable | Present for authenticated reports |
| `install_id_hash` | string | Hash install id before storing if possible |
| `ip_hash` | string | Hash IP for abuse analysis |
| `app_version` | string | Desktop app version |
| `platform` | string | OS |
| `arch` | string | CPU arch |
| `process_type` | string | main, renderer, worker, utility, gpu |
| `crash_type` | string | uncaught exception, renderer gone, etc. |
| `message_preview` | string | Redacted and truncated |
| `payload_ref` | string nullable | Object storage key or local path token |
| `payload_size` | int | Stored payload size |
| `duplicate_counted` | bool | True when metadata only |
| `created_at` | datetime | Ingestion time |

### 7.2 Crash Fingerprint Aggregate

Suggested table: `crash_fingerprint`

| Field | Type | Notes |
|-------|------|-------|
| `fingerprint` | string | Primary key |
| `first_seen_at` | datetime | First report time |
| `last_seen_at` | datetime | Latest report time |
| `total_count` | int | All reports |
| `stored_payload_count` | int | Full payloads kept |
| `affected_user_count` | int | Approximate distinct users |
| `affected_install_count` | int | Approximate distinct installs |
| `app_versions` | json | Bounded list |
| `platforms` | json | Bounded list |
| `sample_report_id` | string | One report for quick inspection |

## 8. Request Schema

```json
{
  "schemaVersion": 1,
  "appVersion": "1.2.3",
  "platform": "darwin",
  "arch": "arm64",
  "installId": "3f0d7b8e-3c0b-4e39-9a5a-9975e80d6302",
  "sessionId": "b41ef4d8-6b6d-4da7-93e1-a1d311b29c83",
  "crash": {
    "timestamp": "2026-07-03T12:00:00.000Z",
    "processType": "renderer",
    "crashType": "render-process-gone",
    "message": "Renderer process gone: crashed",
    "stack": "optional redacted stack",
    "reason": "crashed"
  },
  "recentErrors": [],
  "breadcrumbs": []
}
```

## 9. Backend Logging Rules

The ingestion endpoint must not log raw payloads. It may log compact metadata only:

```text
crash_report_received report_id=cr_123 fingerprint=fp_456 app_version=1.2.3 platform=darwin size=18422 authenticated=true
```

The endpoint must not log:

- stack trace body
- breadcrumb messages
- request body
- headers containing auth
- install id in raw form
- IP in raw form, unless existing security policy already permits it

## 10. Security Requirements

| ID | Requirement |
|----|-------------|
| SEC-1 | Treat every request as hostile, including authenticated requests. |
| SEC-2 | Enforce body size before parsing. |
| SEC-3 | Validate schema before storage. |
| SEC-4 | Redact before logging and storage. |
| SEC-5 | Rate limit anonymous and authenticated reports. |
| SEC-6 | Do not execute, render, or evaluate crash payload content. |
| SEC-7 | Admin display must escape all payload strings to prevent XSS. |
| SEC-8 | Return generic errors for malformed reports. |
| SEC-9 | Monitor spike in rejected reports as possible abuse. |
| SEC-10 | Use CSRF-safe behavior according to existing API auth model. For bearer-token API calls, require JSON content type and do not rely on cookies alone. |

## 11. Failure Behavior

| Scenario | Expected behavior |
|----------|-------------------|
| Body too large | Reject with 413 |
| Invalid schema | Reject with 400 |
| Rate limited | Reject with 429 |
| Storage over budget | Store metadata only or reject with 503, based on configured policy |
| Object storage unavailable | Use local fallback if enabled, otherwise metadata only |
| DB unavailable | Reject with 503 |
| Redaction failure | Reject and log metadata-only redaction error |

## 12. Rollout Plan

### Phase 1: Safe Ingestion MVP

- Add route with body limit.
- Add request schema validation.
- Add server-side redaction.
- Add rate limits by IP and install id.
- Store metadata and sanitized payload in local dedicated directory.
- Add cleanup job and max directory size.

### Phase 2: Deduplication and Aggregates

- Add fingerprint computation.
- Add aggregate table.
- Convert duplicate floods to counter-only writes.
- Add basic metrics.

### Phase 3: Object Storage and Admin Review

- Move payloads to object storage if available.
- Add admin list and report detail endpoints.
- Add filters and report id lookup.

### Phase 4: Alerting and Release Health

- Alert on crash spikes by app version.
- Add release comparison views.
- Add automatic stale payload cleanup verification.

## 13. Success Metrics

| Metric | Target |
|--------|--------|
| Raw crash payloads written to backend logs | 0 |
| Accepted malformed payloads | 0 |
| Endpoint p95 latency | Less than 300 ms for normal payloads |
| Default accepted request size | Less than or equal to 256 KB |
| Local crash storage exceeding budget | 0 sustained occurrences |
| Duplicate crash flood full-payload writes | Capped after configured threshold |
| Reports with known secret patterns after redaction | 0 |

## 14. Acceptance Criteria

1. `POST /api/crash-reports` accepts a valid desktop crash report and returns a report id.
2. The endpoint rejects payloads above the configured body limit.
3. The endpoint rejects unknown top-level fields and invalid enum values.
4. The endpoint redacts known token, cookie, password, and authorization patterns before storage.
5. The endpoint does not write raw payloads into Beego logs.
6. Rate limiting works for IP, install id, user id, and fingerprint.
7. Duplicate reports increment counters after full-payload cap is reached.
8. Cleanup job removes expired payloads and respects local storage budget.
9. Tests cover schema validation, redaction, rate limiting, deduplication, and retention cleanup.

## 15. Open Questions

1. Should anonymous crash reporting be enabled immediately or gated behind a server config flag?
2. Should install ids be stored as hashes only, or does support need raw install id lookup?
3. Which object storage provider should be used in production?
4. What admin role should be required to inspect sanitized crash payloads?
5. Should crash upload be allowed from old desktop app versions after a cutoff date?

