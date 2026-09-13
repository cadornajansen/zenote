# Production security boundary

This document records Zenote's implemented Phase 5 and Phase 6 controls. It is not a
generic security checklist.

## Browser headers and CSP

`proxy.ts` creates a cryptographically random nonce for each document request,
puts the same CSP on the request and response, and lets Next.js nonce its
framework scripts. This follows the installed Next.js 16.3.3 App Router guide.
Zenote's layouts already read the session cookie, so the nonce does not newly
turn static pages dynamic.

The production policy permits scripts from Zenote with the request nonce and
`strict-dynamic`; `unsafe-eval` is development-only. Inline styles remain
enabled because the existing UI, Streamdown/Shiki highlighting and KaTeX emit
style elements or attributes. `img-src` permits self, HTTPS and data images
because the Markdown renderer supports those sources. `connect-src` permits
self and the configured Appwrite origin; development additionally permits HMR
WebSockets. There are no analytics, Realtime, remote font or external script
origins. `object-src` and `frame-src` are disabled, and `frame-ancestors 'none'`
is paired with `X-Frame-Options: DENY`.

Global headers also set `nosniff`, `strict-origin-when-cross-origin`, a
restrictive Permissions Policy, and production-only HSTS for one year with
subdomains. HSTS does not request preload. Clipboard is intentionally not
disabled because copy actions use it. COOP, COEP, CORP and Trusted Types are not
enabled without compatibility evidence.

## Sessions, OAuth and request origin

Appwrite owns credentials and sessions. Zenote stores only the Appwrite session
secret in `zenote-session`: HttpOnly, Secure in production, SameSite=Lax,
Path=/, with Appwrite's expiry. Lax preserves OAuth top-level navigation while
unsafe custom APIs require a same-origin `Origin` header. Logout attempts to
delete the current Appwrite session and expires the cookie even when that
request fails. Missing, invalid and expired session cookies are unauthenticated.

OAuth and recovery callback IDs/secrets are bounded before Appwrite calls.
OAuth session cookies are written only after `createSession` succeeds. Redirects
use `NEXT_PUBLIC_APP_URL`, never callback query parameters, Host, or
X-Forwarded-Host. OAuth callback responses are not cached and use
`Referrer-Policy: no-referrer`. Provider errors are mapped to stable messages;
sign-in and recovery do not disclose whether an account exists.

`POST /api/chat` and `POST`, `PATCH`, and `DELETE /api/attachments` reject a
missing, `null`, malformed, or cross-origin Origin. Production compares against
the normalized configured app origin, which is stable behind Appwrite's proxy;
forwarded host headers are deliberately ignored. Attachment GET and the OAuth
GET callback are exempt. Next.js Server Actions retain the framework's built-in
Origin versus Host/X-Forwarded-Host validation; Zenote does not add a parallel
CSRF token system.

## Appwrite least privilege

API keys bypass Appwrite row and file ACLs. Scope each credential separately
and never place a server key in a browser bundle or Function variable.

| Credential | Runtime and purpose | Minimum scopes used by Zenote |
| --- | --- | --- |
| Browser/session | Browser ping and per-request Site session client | No API key. The session is constrained by Auth plus row/file ACLs. |
| `APPWRITE_API_KEY` | Running Site: Auth SSR, admission rows, trusted profile/attachment mutations, and wrapped-DEK rows | `sessions.write`, `rows.read`, `rows.write`, `files.write`. Reconfirm Auth scope against the deployed Appwrite version before removal. |
| `APPWRITE_EXECUTION_API_KEY` | Running Site: enqueue the existing attachment Function | `executions.write` only. For compatibility the code falls back to `APPWRITE_API_KEY`; hardened production should configure the split key. |
| Dynamic execution key | Appwrite-injected `x-appwrite-key` inside the attachment Function | `rows.read`, `rows.write`, `files.read`. The checked-in Function settings contain exactly these scopes. |
| `APPWRITE_PROVISIONING_API_KEY` | Operator setup only; create/update schema, bucket and Function settings | `databases.read`, `tables.read/write`, `columns.read/write`, `indexes.read/write`, `rows.read/write`, `buckets.read/write`, `functions.read/write`. The opt-in live DB smoke test additionally needs `users.write` for its disposable users. Remove this key from the Site runtime after setup/testing. |
| CLI/deployment credential | Operator or CI deployment only | Function/deployment read/write permissions required by the Appwrite CLI. No tracked CI workflow currently exists; verify the actual CI secret store and Console grants manually. |

The execution and provisioning variables have compatibility fallbacks so local
development does not break immediately. A production release is not considered
least-privilege until the Appwrite Console confirms that the runtime data key no
longer has schema, Function-management, deployment, or execution scopes.

## AWS least privilege

The attachment Function sends image bytes directly; it does not use S3, SNS,
async Textract jobs, or `iam:PassRole`.

| Call | Required action | Resource restriction |
| --- | --- | --- |
| Image document analysis | `textract:AnalyzeDocument` | `*` because Textract exposes no resource type for this synchronous action |
| Single-page scanned PDF fallback | `textract:DetectDocumentText` | `*` for the same reason |
| Two sequential Nova `Converse` calls | `bedrock:InvokeModel` | Exact inference-profile ARN and all underlying destination foundation-model ARNs |
| Inference-profile use | `bedrock:GetInferenceProfile` | Exact configured inference-profile ARN |
| Per-user DEK creation | `kms:GenerateDataKey` | Exact `ZENOTE_KMS_KEY_ARN` only |
| Wrapped DEK unwrapping | `kms:Decrypt` | Exact `ZENOTE_KMS_KEY_ARN` only |

For a cross-region/global profile, enumerate every destination model ARN and
update the policy when AWS changes the profile. If that cannot be operated
reliably, use a narrow region wildcard for the exact Nova foundation-model ARN
and require the exact profile ARN with an IAM condition. Do not grant
`bedrock:*`, `textract:*`, AdministratorAccess, or PowerUserAccess.

## Attachment memory and Cloud acceptance

The Function runs on Node.js 22, 512 MB RAM, 0.5 CPU, with a 120-second
cooperative deadline and 300-second hard timeout. Images are limited to 3.5 MB,
8000 pixels per edge, one page, and 64 million input pixels. The current local
pre-provider path calls `sharp(...).metadata()`, which reads headers without
decoding a full RGBA raster. The theoretical 256 MB RGBA allocation is therefore
not present in the current implementation. Original compressed bytes are then
sent to Textract and to two sequential Bedrock requests, so SDK serialization
and provider responses still require real-runtime evidence.

Run the non-billable local measurement with:

```sh
npm --prefix functions/attachment-processor run stress:image-memory
```

It creates maximum and near-maximum PNG/JPEG fixtures under the 3.5 MB policy,
runs the real `sharp.metadata` validation in isolated child processes, and
reports duration plus RSS, heap and external-memory snapshots. It never invokes
Textract or Nova. These numbers do not establish Cloud safety.

The 2026-09-13 local Windows run used Node 24.18.0, Sharp 0.35.4 and libvips
8.18.6. All cases succeeded: the 8000x8000 203,111-byte PNG completed in 2.54 ms
with a 339,968-byte peak RSS delta; the 7800x7800 193,482-byte PNG completed in
1.58 ms with a 479,232-byte RSS delta; and the 8000x8000 375,265-byte JPEG
completed in 1.63 ms with a 286,720-byte RSS delta. Peak heap deltas were
215,336–215,456 bytes and peak external-memory delta was 39,971 bytes for each
case. This supports keeping
the current dimension limit pending Cloud validation; it does not measure AWS
SDK serialization or prove Node 22/Appwrite behavior.

For live acceptance, deploy the reviewed Function unchanged on
`s-0.5vcpu-512mb`. In a disposable owned conversation, upload one fixture at a
time: 8000x8000 high-compression PNG, 8000x8000 JPEG, and 7800x7800 PNG/JPEG.
Repeat each at least three times. Record only deployment/execution IDs, duration,
terminal status/error category, and numeric peak RSS if Appwrite exposes it.
Each run must reach `ready` before both deadlines with no OOM/restart. Delete the
disposable conversation afterward. This full path invokes paid Textract/Nova,
so it requires operator approval and configured provider access. If OOM or
timeouts occur, lower the pixel/dimension policy and repeat before considering a
larger compute tier.

## Secrets, content and dependencies

Chat and Function logs contain request/execution IDs, stage, kind, byte counts,
timings, result codes and bounded provider request IDs. They do not include
authorization headers, API keys, prompts, messages, attachment text,
`processedText`, OCR output, or provider bodies. Browser Appwrite startup errors
are logged as a fixed message. API responses expose only safe status metadata.

The Phase 5 audit upgraded Next.js and its matched ESLint config from 16.2.6 to
16.3.3 because the installed version had critical and high advisories. The
Function's independent production dependency audit is clean and its Sharp
0.35.4 is already on the patched line. The separate native dependency trees are
intentional because the Function is deployed independently from the Site.

## Application-Level Content Encryption

The Site and attachment Function independently implement the same `zenc:v1`
envelope: AES-256-GCM with a fresh 12-byte nonce and 16-byte authentication tag.
The envelope is `zenc:v1:<keyVersion>:<nonce-base64url>:<ciphertext-base64url>:<tag-base64url>`.
Each user/key-version receives a KMS `GenerateDataKey` AES-256 DEK; only the
KMS-wrapped value is persisted in `user_crypto_keys`. KMS encryption context is
exactly `application=zenote`, `purpose=content-encryption`, Auth user ID, and
key version. A bounded, process-local DEK cache defaults to 256 entries and five
minutes; working copies, cache eviction, and expiry zero buffers.

The deterministic GCM AAD array is `["zenote","content","v1",userId,entityType,rowId,fieldName,keyVersion]`.
It binds ciphertext to its owner, row, and field. The Site proves session ownership
before decrypting. New writes encrypt `messages.content`, `conversations.title`,
`conversations.systemPrompt`, `user_preferences.customInstructions`, and
`attachments.processedText`; filenames and operational metadata remain plaintext.
Malformed envelopes, authentication failures, missing KMS configuration, and KMS
failures fail closed without a plaintext fallback. Legacy plaintext is permitted
only by the explicit `ZENOTE_CRYPTO_ALLOW_LEGACY_PLAINTEXT=true` migration setting.

Create a symmetric customer-managed CMK in `us-east-1`; do not use an AWS-managed
key. Give the Site and Function AWS principals only `kms:GenerateDataKey` and
`kms:Decrypt` against that key ARN. Restrict the CMK key policy and principal IAM
policy to the same two actions, and, where operationally feasible, enforce the
four required encryption-context pairs. Do not grant `kms:*`, `kms:Encrypt`,
`kms:ReEncrypt*`, `kms:DescribeKey`, or wildcard resources. Configure the same
KMS ARN, active key version, cache limits, and AWS credentials as secret Site and
Function variables. A key row records the CMK ARN that wrapped its DEK, so a CMK
ARN rotation can retain decrypt access to historical rows; grant `kms:Decrypt` on
each retained CMK and `kms:GenerateDataKey` only on the active CMK. No cryptographic
key material reaches a browser bundle.

Before a production rollout: run setup, dry-run migration, apply migration, and
verify migration; then set legacy plaintext false and deploy the Site and Function
together. Live acceptance must create a chat and attachment, confirm Appwrite rows
contain only `zenc:v1:` envelopes, confirm UI/history and attachment context decrypt
correctly for the owner, verify another user cannot retrieve them, and test a KMS
denial/outage to confirm writes and reads fail without plaintext persistence or logs.
Run `pnpm benchmark:crypto` to record local AES-GCM throughput for the 24,000-byte
attachment context limit. It is an algorithm-only benchmark: it does not call KMS
or Appwrite and is not a production latency estimate.

Retention-policy implementation, billing, usage events, RAG, agents, failover,
queues and Realtime remain deferred.
