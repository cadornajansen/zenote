# Attachment processing handoff

## Runtime boundary

The Site uploads and authorizes files, enqueues one asynchronous Appwrite Function, polls safe metadata, and builds chat context from cached text. It never parses attachments or calls attachment providers. `functions/attachment-processor` is an independently installed/deployed TypeScript ESM Node package, with no imports from Next.js or the Site and no root path aliases. Its local strict NodeNext `tsconfig.json` compiles `src/*.ts` to ignored `dist/*.js`.

`appwrite.config.json` is the source of truth for Function settings. `pnpm setup:appwrite` reconciles those settings alongside the existing tables/bucket; the official Appwrite CLI packages and deploys the Function code. No schema columns, queue service, scheduler, Realtime subscriptions or extra infrastructure were added by this migration.

| Setting                    | Value                                                           |
| -------------------------- | --------------------------------------------------------------- |
| ID / name                  | `attachment-processor` / Zenote Attachment Processor            |
| Runtime / entrypoint       | `node-22` / `dist/main.js`                                      |
| Build command              | `npm ci --include=dev && npm run build && npm prune --omit=dev` |
| Hard timeout               | 300 seconds                                                     |
| Build specification        | `s-2vcpu-2gb` (2 GB, 2 CPU; lowest allowed build tier)          |
| Runtime specification      | `s-0.5vcpu-512mb` (512 MB, 0.5 CPU)                             |
| Client execute permissions | `[]`                                                            |
| Dynamic key scopes         | `rows.read`, `rows.write`, `files.read`                         |
| Triggers                   | Server async execution only; no events or schedule              |
| Request body               | Exactly `{"attachmentId":"..."}`                                |

Transactions use `rows.write`; no additional transaction scope is needed. The Site uses the optional `APPWRITE_EXECUTION_API_KEY` with canonical `executions.write` to enqueue work; it falls back to the data key for compatibility. The Function does not need this scope and cannot queue itself.

Build and runtime tiers are separate. This project's `listSpecifications({type: "builds"})` allows a minimum of `s-2vcpu-2gb`; the runtime list allows `s-0.5vcpu-512mb`. Using the runtime minimum for builds causes `400 general_argument_invalid` on `buildSpecification`. Recheck both lists before changing tiers on another project.

## State and recovery

1. The browser saves an owned user message, then POSTs each file with its stable slot. Server validation limits names, extensions and streamed bytes. Metadata and private blobs retain the deterministic owner/message/slot ID and SHA-256.
2. The Site verifies the canonical complete private blob, transactionally reserves `metadata.queued`, sets `processing`, then calls `createExecution({functionId, body, async:true})`. POST returns 202 with a safe summary, not processed text.
3. The Function transaction verifies owner/message relationships, tombstone, row ACL/type/hash and queue state. One execution claims a UUID lease. Simultaneous claims conflict; ready, failed and already leased duplicates do nothing.
4. The Function verifies blob ID/name/size/chunks/owner ACL/hash, performs byte validation and extraction, then transactionally persists bounded text or a safe failure code. Image output is assembled deterministically from Textract evidence and Nova visual analysis so exact OCR cannot be replaced by an LLM summary. Only the matching lease/hash can finish. Both claim and finish touch the conversation to conflict with deletion.
5. The browser GET-polls message summaries at 800 ms, increasing to at most 3 seconds, for at most seven minutes. Polling aborts on navigation/unmount, stops on failure/removal, and resumes processing chips on reload. It never retries paid work itself. Once all files are ready, normal text chat starts.
6. Chat independently returns `409` with `code: attachments_processing` for uploaded/processing current files, or `422` with `code: attachment_failed` for failed ones. It only reads cached ready text. Follow-ups do not invoke preprocessing again.
7. Explicit PATCH retry reuses uploaded/failed files or reclaims a processing row older than six minutes. Fresh processing/ready rows are idempotent. Enqueue failure releases only its still-unclaimed reservation to `uploaded` with `enqueue_failed`; an ambiguous execution that already claimed is not overwritten.

The processing signal is two minutes; provider cleanup has its own ten-second deadline. Local native/parser code cannot be forcibly interrupted by an AbortSignal, so the 300-second Appwrite runtime timeout is the hard boundary. A crash, hard timeout or failed state write can leave `processing`; explicit retry after six minutes is the recovery mechanism. There is no automatic sweep or provider replay. Old pre-migration leases can recover through the same expiry path.

Deleting an attachment removes the blob before its row. Deleting a conversation tombstones first and removes attachments/files, messages, then the parent. A worker cannot recreate missing rows or finish after a tombstone. Storage and TablesDB are not a single transaction; an interrupted upload/deletion may still require operator reconciliation. Never blindly retry or remove rows while a live Function execution may still be running.

## Variables

| Location                                | Variables / handling                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Site only                               | `APPWRITE_API_KEY` (secret data/auth key), recommended `APPWRITE_EXECUTION_API_KEY` (secret execution-only key), `APPWRITE_DATABASE_ID`, `APPWRITE_STORAGE_BUCKET_ID`, existing public endpoint/project and app URL, `ASSEMBLYAI_LLM_BASE_URL` |
| Setup/CI only                           | `APPWRITE_PROVISIONING_API_KEY`; remove it from the running Site after schema/Function setup                                                                                   |
| Function or shared project              | `ZENOTE_DATABASE_ID`, `ZENOTE_STORAGE_BUCKET_ID`; optional `ZENOTE_ATTACHMENTS_TABLE_ID=attachments`                                                                            |
| Shared project where already configured | `ASSEMBLYAI_API_KEY` (secret): Site gateway and Function STT both use it                                                                                                        |
| Function or existing project            | `AWS_REGION`, `BEDROCK_NOVA_VISION_MODEL_ID`; legacy fallback `BEDROCK_NOVA_MODEL_ID`; secret `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional secret `AWS_SESSION_TOKEN` |
| Injected by Appwrite                    | `APPWRITE_FUNCTION_API_ENDPOINT`, `APPWRITE_FUNCTION_PROJECT_ID`, per-execution `x-appwrite-key` request header                                                                 |

Do not manually define reserved `APPWRITE_*` Function variables or copy the Site API key into the Function. `ZENOTE_*` IDs must point to the same database/bucket the Site uses. Reuse existing project variables rather than duplicating credentials into Function variables; Function-level values override project values. Set provider credentials as secrets. Redeploy after variable changes.

Image processing defaults to the active `global.amazon.nova-2-lite-v1:0` inference profile. AWS lists Nova Premier as legacy with an EOL date of September 14, 2026, so it is not the deployment default. Override `BEDROCK_NOVA_VISION_MODEL_ID` only with a multimodal Nova inference profile that is invocable from `AWS_REGION`; the legacy `BEDROCK_NOVA_MODEL_ID` is read only as a rollout fallback. Known profile-only bare IDs are rejected as configuration errors.

The least-privilege AWS actions are `bedrock:InvokeModel` and `bedrock:GetInferenceProfile` for the configured inference profile and its destination foundation models, `textract:AnalyzeDocument` for images, and `textract:DetectDocumentText` for the unchanged single-page scanned-PDF fallback. No S3 permissions are needed because bytes are sent directly. Cross-region inference SCPs and IAM resource restrictions must allow every destination region in the selected profile; do not grant wildcard administrative actions.

Image `processedText` is cached in this order: `[EXTRACTED TEXT]`, structured key/value pairs, tables, layout, `[VERIFIED VISUAL ANALYSIS]`, then safe `[PROCESSING INFORMATION]`. The deterministic 24k builder gives OCR and structured values priority over verbose vision prose. Processor values indicate the available evidence: `image:textract+nova+verify`, `image:textract+nova`, `image:textract`, `image:nova+verify`, or `image:nova`.

## Deployment

The initial migration stopped at `appwrite whoami` with no active session. During the subsequent setup fix, the authorized server key successfully provisioned and read back the Function settings after correcting `buildSpecification` to the project's lowest allowed build tier. Node 22, entrypoint, timeout, execution permissions, dynamic scopes and both specifications are verified. The Function has no code deployment yet; variables/provider access and runtime behavior remain unverified. No provider executions were started by the setup fix.

After an authorized operator supplies CLI authentication and confirms the regional project in `appwrite.config.json`:

```sh
pnpm setup:appwrite
npm --prefix functions/attachment-processor ci
npm --prefix functions/attachment-processor run typecheck
npm --prefix functions/attachment-processor run build
pnpm test
pnpm test:function
pnpm typecheck
pnpm lint
pnpm build
pnpm dlx appwrite-cli@27.3.0 push function --function-id attachment-processor --activate --force
```

Configure/reuse the variables above before pushing. The setup key additionally needs `functions.read/write`; CLI deployment credentials need Function/deployment permissions. Do not use `--with-variables`: it replaces remote variables from a local `.env` and can delete existing secrets. Do not deploy the Site migration until the Function is active, configured, and the execution key has `executions.write` (or the compatibility data key retains it). Otherwise attachment enqueueing fails safely and text-only chat remains the available path. `--force` is for a reviewed Function configuration, not permission errors or unrelated empty configuration fields.

Root `pnpm build` builds only the Next.js Site. The Function has its own `npm run build` command and is built by Appwrite from `functions/attachment-processor/package.json` when the Function is deployed. Root `pnpm typecheck` still checks both packages locally; `pnpm build:function` explicitly builds only the Function. Root TypeScript excludes `functions/` so Next's compiler settings do not leak across this boundary. Appwrite builds the Function from its checked-in TypeScript and lockfile, then prunes build-only dependencies; generated `dist/` is not uploaded from a developer machine.

The Site build must not install or build the Function's dependencies. Configure the Appwrite Site build command as `pnpm build` (or `next build`) and the Function command remains `npm ci --include=dev && npm run build && npm prune --omit=dev` in `appwrite.config.json`.

Local Appwrite runtime testing uses Docker and `pnpm dlx appwrite-cli@27.3.0 run functions --function-id attachment-processor`; local execution does not enforce all Cloud permissions/timeouts, so it cannot replace a deployed smoke test. Unit tests use the same Function-local compiled parser imports and a real small generated PDF with an xref table, not parser stubs or Next tracing.

## Verification matrix

Automated tests never use real paid providers. Function tests stub AWS SDK sends and AssemblyAI fetch; local extraction is real.

Local verification after the TypeScript conversion and review fixes: 47 root tests and 17 compiled Function tests pass; Function typecheck/build, combined root typecheck, lint and the Next production build pass. The first Next build could not fetch the existing Google Fonts; a retry passed without source or TLS-setting changes. Independent reviews covered the typed Function boundary and the Site's enqueue, retry, ownership and deletion paths. Review fixes normalize polling timeouts and malformed Function metadata errors. None of these local results establishes deployed permissions, provider access or Cloud runtime behavior.

| Scenario                          | Deterministic coverage                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1. TXT and Markdown               | Function real UTF-8 normalization/extraction                                                    |
| 2. DOCX                           | Real Mammoth with ZIP fixture                                                                   |
| 3. Text PDF                       | Real pdf-parse, no OCR request                                                                  |
| 4. Single-page empty PDF          | Only bounded synchronous Textract fallback                                                      |
| 5. Multi-page scans and long PDFs | Reject scans; first 45/last 5 sampling                                                          |
| 6. Images                         | sharp, mocked AnalyzeDocument, two mocked Nova passes, exact-value retention and degraded modes |
| 7. Audio                          | AssemblyAI upload/transcript/poll, cleanup success/error                                        |
| 8. Invalid formats/signatures     | Site type limits; Function byte checks                                                          |
| 9. Size and expansion limits      | Four slots, byte/ZIP/image limits                                                               |
| 10. Empty/cancelled processing    | Safe rejection, no ready content                                                                |
| 11. Upload and async enqueue      | 202 response, exact ID-only async payload                                                       |
| 12. Enqueue failure               | Reservation release and explicit retry                                                          |
| 13. Simultaneous executions       | Optimistic transaction conflict, one processor call                                             |
| 14. Repeat ready/failed execution | No provider replay; cached text preserved                                                       |
| 15. Stale recovery/completion     | Expired Site retry; superseded Function lease cannot write                                      |
| 16. Authentication and ownership  | All Site verbs, foreign parent/message/ACL rejection                                            |
| 17. Private file integrity        | Hash, file ID/name/size/chunks/ACL checks                                                       |
| 18. Tombstone and deletion races  | No post-delete resurrection; blob-first cleanup                                                 |
| 19. Safe status/reload            | No private fields; GET-only polling, terminal/abort behavior                                    |
| 20. Chat readiness gates          | 409/422 before gateway or assistant persistence                                                 |
| 21. Cached follow-ups             | Ready normalized context, no processing                                                         |
| 22. Existing text chat            | Gateway/SSE/fallback/abort/persistence regression suite                                         |

## Live smoke checklist

Code deployment and authenticated browser smoke are **not completed**. Function settings alone are provisioned; authenticated CLI deployment and configured variables are still required. Once deployed, use a disposable owned conversation and the existing UI, not direct forged admin rows:

1. Upload a small text PDF, TXT and DOCX. Observe 202, GET `processing` to `ready`, then an answer referring to the file. For PDF logs confirm `processor: pdf-parse`, page/text counts and `ocrFallback: false`, without document text in logs.
2. Upload `05-image-nova.png` and ask: `analyze this image. extract the project information and tell me which milestone has the highest progress.` Confirm the answer includes Orchid Lantern; March 17, 2031; PHP 248,750; Mira Santos; Davao City; cobalt-river-42; Research 90%; Prototype 70%; Testing 45%; Launch 20%; and identifies Research at 90% as highest. Inspect the owned attachment row and confirm `processedText` itself contains every value, with processor `image:textract+nova+verify` in the full-success case.
3. Test one image with each provider stage unavailable. Confirm verification failure uses primary vision, vision failure uses OCR, OCR failure uses verified vision, and only combined OCR/vision failure marks the attachment failed. These steps are billable; inspect provider access first.
4. Upload a small text PDF, TXT and DOCX, plus a short MP3/WAV/FLAC/OGG. Confirm the unchanged local/PDF/audio paths and cached follow-ups.
5. Reload during processing and after completion. Chips recover; ready files do not enqueue again. Verify desktop/mobile layout remains unchanged and navigation aborts polling, not the accepted server execution.
6. Test direct chat before ready, unsupported/malformed bytes, one-page scan fallback and multi-page scan rejection. Verify safe 409/422/errors and no assistant completion on failure.
7. Repeat enqueue/execution, retry a failed or expired job, and delete an attachment/conversation during processing. Verify no duplicate provider work for a fresh lease or stale completion, and no resurrected rows/files.
8. As a second user, verify upload/status/retry/delete/download denial for the first user's IDs. Confirm client Appwrite execution is denied by `execute: []`.
9. Delete disposable conversations and confirm their blobs/rows are removed. Record deployment ID, safe execution statuses and checks, never secrets, OCR text or provider response bodies.

Remaining rollout requirements include actual Cloud build/memory/runtime validation on the lowest specification, credentials/scopes/model access, and the live checks above. [Phase 4 admission controls](admission-controls.md) now protect upload bytes and processing jobs with aggregate safety quotas and concurrency admission. Deploy the Function's enqueue-expiry guard before the Site admission changes; drain older jobs before rollout.
