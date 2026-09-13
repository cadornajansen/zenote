# Phase 4: spend and abuse admission

These server-only safety limits decide **whether work may start**. They are not
customer plan quotas, a usage ledger, token accounting, or billing. A future usage
ledger can independently record what actually happened and its cost.

## Configuration

Set these variables on the Appwrite Site (defaults shown in `.env.example`):

| Variable | Default |
| --- | ---: |
| `ZENOTE_CHAT_PER_MINUTE` | 10 |
| `ZENOTE_CHAT_PER_DAY` | 200 |
| `ZENOTE_CHAT_MAX_CONCURRENT` | 2 |
| `ZENOTE_ATTACHMENTS_PER_DAY` | 20 |
| `ZENOTE_ATTACHMENT_BYTES_PER_DAY` | 104857600 (100 MiB) |
| `ZENOTE_ATTACHMENTS_MAX_CONCURRENT` | 4 |
| `ZENOTE_GLOBAL_CHAT_PER_DAY` | 5000 |
| `ZENOTE_GLOBAL_ATTACHMENTS_PER_DAY` | 500 |
| `ZENOTE_CHAT_ENABLED` | true |
| `ZENOTE_ATTACHMENTS_ENABLED` | true |
| `ZENOTE_CHAT_LEASE_SECONDS` | 300 |
| `ZENOTE_ATTACHMENT_LEASE_SECONDS` | 360 |

Configuration is centralized and validated at the server admission boundary.
Integers must be positive safe integers; concurrency is bounded to 100 to keep
the single lease row small. Booleans accept only `true` or `false`. Invalid policy
fails closed with a safe 503. Lease durations cannot be shorter than the existing
operation deadlines (300/360 seconds minimum).

## State and atomicity

`usage_counters` is a private TablesDB table with no client table or row permissions.
Bucket fields: `scope`, `subjectId`, `resource`, `window`, `windowStart`, `count`.
IDs are the first 36 hexadecimal characters of SHA-256 over the ordered key fields
(Appwrite's row ID length limit). UTC minute/day boundaries are fixed, with no
reset jobs. Rejected attempts may leave a zero-count bucket, never a charge.
`$updatedAt` supplies operational timestamps; an index on `windowStart` supports
future cleanup. Cleanup is deferred; any future bucket cleanup must exclude
`window=lease` rows, whose epoch timestamp is an identity anchor, not their expiry.

The same table has one `window=lease` row per user/resource, anchored at the Unix
epoch, containing a bounded JSON `leases` field: random token, expiry timestamp,
and attachment ID where applicable. No per-request rows are created. No content,
filenames, IP addresses, OCR, provider budgets or credentials enter these rows.

Admission stages counter increments, checks the staged values, and acquires the
user's concurrency lease in one optimistic transaction. Decisions read **after
the first staged write**, so Appwrite captures the row revision before comparison.
Any denial rolls back all staged charges. Conflicts get bounded retries; storage
or transaction outages fail closed. Lost commit responses are checked using
`getTransaction`; ambiguous outcomes are never blindly replayed.

## Paid-operation boundaries

Chat: authenticate and validate input, saved ownership/history and ready attachment
context → kill switch → user minute/day and global day counters → concurrency
lease → provider → release in stream `finally` (or initial request failure).
Provider errors, aborted streams and timeouts retain quotas because cost may have
occurred. A crashed server recovers its concurrency capacity through lease expiry.

Attachments: validate actual buffered bytes and ownership/slot → kill switch →
daily bytes → Storage. Reusing an already verified upload does not charge bytes
again. An explicit pre-acceptance Storage rejection compensates bytes. Ambiguous
network/server failures conservatively retain quota.

Before enqueue, existing owner/blob validation and duplicate suppression run.
The existing processing reservation, user/global daily job counters and user
concurrency lease commit together, then `createExecution` runs. Explicit
pre-acceptance rejection resets the fenced reservation and compensates jobs in
one transaction. Accepted executions retain quota even on later processor failure.
Ambiguous enqueue failures retain both charge and reservation; immediate retries
are suppressed rather than risking duplicate provider work.

Attachment concurrency reconciles tracked IDs against existing processing status.
The shared per-user lease row serializes admissions across conversations; a plain
status count query is never the locking primitive. The Function does not call back
to admission for normal completion. Compensation/release failures conservatively
retain capacity until recovery/expiry rather than undercounting spend.

Enqueue metadata carries an `admissionExpiresAt` deadline. The Function refuses to
claim an attempt after that deadline. Its concurrency slot is retained for that
deadline plus the existing 360-second processing safety lease (720 seconds total
by default), covering jobs claimed just before the deadline. Ready/failed jobs
release capacity lazily on the next admission; deleted rows retain their slot
until expiry because deleting metadata cannot recall an in-flight provider call.

## Emergency behavior and operations

User rate/day/concurrency denials return 429 with stable codes
`rate_limit_exceeded`, `daily_limit_exceeded`, `concurrency_limit_exceeded`.
Deterministic minute/day denials include `retryAfter` and `Retry-After` seconds.
Global exhaustion returns 503 `service_capacity_reached`, without disclosing any
counts. Kill switches return 503 `service_temporarily_unavailable` and block new
paid operations. Changes require updating deployment environment configuration;
already-started provider operations cannot be recalled.

Safe JSON events: `admission.allowed`, `admission.denied`,
`admission.global_denied`, `admission.concurrency_denied`; metadata is limited to
resource, scope, category and status. Raw user IDs and user content are omitted.

Run `pnpm setup:appwrite` with the existing provisioning credential before deploying
the Site. Setup remains idempotent and enforces private table permissions. Runtime
uses the existing server-only TablesDB row/transaction access; no browser or Function
access to `usage_counters` is needed. Automated concurrency tests use a staged-write,
revision-checking TablesDB fixture and mocked providers, never paid calls. Deployment
should also confirm transactions against the target Appwrite version with a disposable
test user and low limits, without invoking a paid provider.

Deploy the updated attachment Function before enabling the new Site admission
path. Drain pre-deployment queued/processing attachments first: those older jobs
have neither admission slots nor enqueue deadlines. No new API-key scopes are
required: TablesDB transaction writes use the existing `rows.write` scope, and
transaction reads use `rows.read`.
