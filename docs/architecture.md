# Zenote architecture

> Phase 7/8 update: `lib/usage.ts` owns durable usage events, separate free/purchased balances, immutable ledger rows, and atomic reservations. It is independent from Phase 4 `usage_counters`, which only controls admission. `lib/billing.ts` owns server-only PayMongo QR Ph hosted checkout and signed webhook fulfillment.

## Current repository

Zenote is a Next.js 16.2.6 App Router project using pnpm, TypeScript, Tailwind CSS 4, and shadcn/ui (Base Nova). The public site, Appwrite authentication, and authenticated chat interface are implemented. Authentication uses Appwrite Account APIs, server actions, an HTTP-only session cookie, and server-enforced protected layouts. Chat uses real AssemblyAI LLM Gateway streaming through authenticated `POST /api/chat`. Phase 2 persists users, conversations, messages, user preferences, and a mirror of the model registry in Appwrite TablesDB. Phase 3 adds private Appwrite attachments and cached document/image/audio preprocessing. Durable usage accounting and billing remain planned.

## Locked V1 platform direction

```text
                         Zenote
                           │
                     Next.js app
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
     Appwrite           AI Layer          PayMongo
        │                  │
 ┌──────┼──────┐      Model Router
 │      │      │           │
Auth TablesDB Storage      ├── AssemblyAI
                           ├── Azure
                           ├── Bedrock
                           └── OpenRouter
```

Appwrite Sites is Zenote's intended production hosting platform. Appwrite Auth, TablesDB, and Storage are the preferred backend services. The text AI boundary and centralized model registry remain unchanged; Phase 3 normalizes attachments into text through local parsers, Nova vision, or AssemblyAI speech-to-text. Additional chat gateways and PayMongo remain planned.

## Repository layout

```text
app/
  (public)/            # marketing and legal routes
  (auth)/              # login, signup, and password recovery
  (app)/               # protected chat and settings routes
  auth/oauth/callback/ # Google OAuth session exchange
  api/chat/            # authenticated streaming POST handler
  api/attachments/     # authenticated upload/enqueue, safe status and removal
  globals.css
  layout.tsx           # document-level layout
components/
  ui/                  # installed shadcn primitives
  app-shell.tsx         # responsive authenticated shell
  app-sidebar.tsx       # desktop and mobile chat navigation
  chat-workspace.tsx    # shared empty and conversation UI state
  chat-composer.tsx
  chat-message.tsx
  auth-form.tsx
lib/
  appwrite.ts          # browser-safe Appwrite client
  appwrite-server.ts   # server and session client factories
  auth.ts              # authentication operations
  db.ts                # session-authorized TablesDB operations and profile bootstrap
  ai.ts                # server-only gateway, context, telemetry, tool contracts
  models.ts            # centralized model IDs, capabilities, caching, fallbacks
  chat.ts              # browser transport, shared messages and SSE framing
   attachments.ts       # cached context only; never starts processing
  attachment-policy.ts # shared limits, types and safe chip metadata
   attachment-client.ts # bounded abortable status polling
  mock-chat.ts         # dev fixtures and type-only UI contracts; no live fixture data
  utils.ts
scripts/
  setup-appwrite.mjs   # tables/bucket/Function settings and registry seeding
functions/
  attachment-processor/ # standalone TypeScript/Node 22 package, compiled to dist/
appwrite.config.json    # sole Function settings/deployment configuration
docs/
```

Route groups organize code without appearing in URLs. The public layout resolves optional auth state for its navbar. The `(app)` layout resolves the current Appwrite user on the server and redirects unauthenticated requests before rendering protected content.

Use `(public)` for marketing/legal routes, `(auth)` for account entry and recovery, and `(app)` for authenticated product routes. The `(app)` layout ensures the Auth-linked profile and loads real sidebar history. `/chat` loads the default model without creating an empty conversation. `/chat/[id]` authorizes and restores the saved conversation and its latest 100 messages. Both share the existing abortable idle-to-thinking-to-streaming workspace. Native URL replacement preserves the first response's mounted UI and scroll state; returning to `/chat` resets the conversation state.

## Current authentication flow

```text
Auth form
   ↓
Next.js server action
   ↓
lib/auth.ts
   ↓
Appwrite Account
   ↓
HTTP-only Zenote session cookie
   ↓
server layout resolves current user
```

Google authentication starts with an Appwrite OAuth2 token URL. Appwrite returns `userId` and `secret` to `/auth/oauth/callback`; Zenote exchanges them for an Appwrite session and stores only the session secret in the HTTP-only cookie. Passwords go directly to Appwrite and are never persisted by Zenote.

## Application boundaries

Keep boundaries direct and small when they become necessary:

- `components/`: mostly flat reusable presentation components. Check `components/ui` before adding UI primitives.
- `lib/ai.ts`: server-side Zenote AI abstraction; provider-specific SDK logic must not reach UI components or scatter across routes.
- `lib/models.ts`: one Zenote-facing model registry and model IDs; provider model IDs stay internal.
- `lib/db.ts`: TablesDB and attachment Storage boundary; sessions prove ownership before restricted server-key attachment lifecycle writes. Normal chat/preferences remain session-authorized.
- `lib/usage.ts`: future usage checks, consumption calculation, limit enforcement, and auditable event recording.
- `lib/billing.ts`: future PayMongo boundary, independent from provider object shapes.
- `lib/attachments.ts`: cached attachment context and readiness gates only. `lib/db.ts` owns session-authorized upload/enqueue/status/removal.
- `functions/attachment-processor/`: isolated asynchronous attachment processing, using its own dependencies and a scoped dynamic Appwrite key. No Next.js imports or user sessions.

`types/` is reserved for shared types only when an implemented boundary needs them. Do not create empty type declarations or fake implementations.

## Persisted request flow

```text
Chat UI
    ↓
server action: commit user prompt + conversation/activity in TablesDB
    ↓
replace first-send URL with /chat/{id}, keeping streaming UI mounted
    ↓
POST /api/chat
   ↓
authenticate
   ↓
authorize saved prompt and validate model and bounded client message history
   ↓
build stable context and call AssemblyAI with one fallback
   ↓
normalize SSE deltas, actual model metadata, and safe errors
   ↓
stream response to existing chat UI (abort propagates upstream)
    ↓
commit completed assistant response + activity timestamp, then emit done
    ↓
log structured completion/error/abort telemetry, without prompts
```

This text flow is implemented. `buildConversationContext` takes normalized user/assistant messages from the bounded client history, initially restored from TablesDB. The saved current prompt must belong to the session's conversation and match the request. Client system/tool roles are rejected. Input size, message count, text capabilities, and output length are bounded. Requests time out after three minutes. Failed/truncated streams are not marked complete; partial text is retained in the UI only. Stop and unmount cancel upstream, and abort before the final database commit rolls back the response write. A late disconnect after a complete response commits does not undo valid history. Failed/stopped partial responses are excluded from subsequent context. No per-token database writes occur.

The first conversation title is cleaned/truncated prompt text, never an additional LLM request. First-send creation and every message/activity update use session-authorized Appwrite transactions. Successful replies use one stable response ID per user prompt. The sidebar holds at most 100 real, non-archived conversations sorted by activity; rename/archive/delete use existing controls. Message deletion uses bounded individually authorized batches, not admin bulk deletion. Model selection persists a default preference for new chats, while existing conversations restore their last-used model. Prompt customization fields exist in the schema but do not change Phase 1 prompt behavior.

Provision with `pnpm setup:appwrite` after configuring an existing database and the server-only setup key. `scripts/setup-appwrite.mjs` creates missing resources, waits for readiness, reconciles permissions, and mirrors `lib/models.ts` without deleting existing data or adding a migration framework. Runtime routing and the picker still use the code registry. See [database.md](database.md) for exact fields, indexes, key scopes, and the live persistence smoke test.

Prompts put the stable system instruction first, older history next, then recent messages/current user input. Attachment material is JSON-escaped, explicitly untrusted data appended to its original user message, never a system instruction or fake persisted message. The total attachment budget is 24,000 characters with recent material prioritized. No tools are sent. OpenAI/Gemini caching is automatic; Claude gets message-level ephemeral breakpoints on the system and older context. Fallback messages are rebuilt without unsupported cache controls. Cache hits require provider minimum lengths and are not guaranteed.

Telemetry records request IDs, requested Zenote model, actual returned provider model, available token/cache counts, latency, status, and rate-limit headers. Missing usage remains unknown, not zero. Cache writes are captured separately when returned. This is not a durable billing ledger or quota enforcement. No automatic application retries or mid-stream fallback replay are performed.

Attachments use authenticated `POST/PATCH/GET/DELETE /api/attachments`. POST verifies the owned saved prompt, bounds uploads, reserves private metadata/storage and asynchronously enqueues `attachment-processor` with only `{attachmentId}`. PATCH explicitly retries; GET returns safe chip summaries, never extracted text. The Site does not parse files, invoke attachment providers, spawn subprocesses or trace parser assets. The browser polls GET from 800 ms up to 3 seconds, stops at terminal status or a seven-minute deadline, aborts on navigation, and resumes pending chips after reload. Chat returns `409 attachments_processing` for unfinished current attachments and 422 for failed ones; it never processes or enqueues files.

The standalone Appwrite Function rechecks the canonical row, parent/message ownership, deletion tombstone, exact owner-read-only row/file ACLs, file metadata and SHA-256. Transactional queue/lease fencing suppresses duplicate execution and stale writes. It runs TXT/Markdown UTF-8, Mammoth DOCX, pdf-parse PDF and sharp image validation directly in its Node 22 package, isolated from the Site. The Function has a 300-second hard timeout, 512 MB/0.5 CPU runtime specification, 2 GB/2 CPU build specification (the project's lowest allowed build tier), two-minute cooperative processing deadline and six-minute stale lease recovery through explicit Site retry. A hard crash may leave a processing row until retry; no scheduler or automatic provider replay is added. See [attachment-processing.md](attachment-processing.md) for deployment and recovery.

PNG/JPEG/WebP use sharp validation followed by synchronous Textract `AnalyzeDocument` (`LAYOUT`, `TABLES`, and `FORMS`), a primary multimodal Nova analysis, and a second Nova verification pass. Exact OCR and structured evidence are retained independently of model prose and receive priority in the deterministic 24k cache. Textract, vision, and verification failures degrade independently; only combined OCR and primary-vision failure rejects an image. Audio still uses AssemblyAI upload/transcript/poll with a two-minute processing timeout. The existing Textract `DetectDocumentText` fallback remains limited to a single-page PDF with no extracted text. Multi-page scans fail clearly; mixed PDFs use available text, not automatic paid OCR of every page. No S3, asynchronous OCR, job service, RAG or vector store is introduced. Ready normalized text is cached in the attachment row, so normal follow-ups make no additional preprocessing calls. All visible chat models remain text-only; native capability flags are not misrepresented.

AssemblyAI transcript deletion is attempted after success, failure or cancellation using a separate cleanup timeout. The provider documents that transcript deletion also removes the uploaded audio. If no transcript ID is received, or cleanup fails, provider retention applies (default upload TTL 72 hours; configure a shorter provider retention policy where required). Zenote does not claim guaranteed provider-side erasure on network failure. Original Appwrite blobs and cached text remain until attachment/conversation deletion. Tool-loop contracts remain inactive; billing webhook, durable cost accounting and automated cleanup/reconciliation remain deferred.

Phase 4 adds private TablesDB admission buckets, per-user concurrency leases, daily global ceilings and deployment kill switches around chat and attachment paid paths. See [admission controls](admission-controls.md) for defaults, atomic semantics and rollout requirements. These are safety controls, separate from future usage metering and billing. Provider-side spend limits and alerts remain useful independent emergency controls.

## AI verification

`pnpm test` runs deterministic Site boundary tests; `pnpm test:function` separately runs real Function-local PDF/DOCX parsing and mocked provider/transaction lifecycle tests. No automated test invokes a paid provider. Live gateway streams may finish with `[DONE]` or clean EOF after a valid `finish_reason`; EOF without a finish signal is an error.

For an opt-in billable gateway smoke test, run `node --env-file=.env.local tests/live-chat.mjs` or append a Zenote model ID such as `claude-haiku-4-5`. It logs timing, usage, and model metadata, not response text or credentials. This does not replace authenticated desktop/mobile browser testing.

## Security and provider isolation

Secrets, including Appwrite API keys, AI provider credentials, AWS credentials, payment credentials, and webhook secrets remain server-only. Browser clients do not determine entitlements, prices, usage totals, provider selection, or trusted billing state. Provider fallback must preserve compatible model semantics, requested capabilities, and correct accounting; it must not silently choose expensive models without usage controls.

Conversations/messages/preferences have row security with owner-only read/update/delete ACLs and table-level authenticated create only. Queries additionally filter by the authenticated owner, and ID lookups check ownership; `userId` is not authorization. Models are authenticated-read-only and provisioner-write-only. Profiles are owner-read-only, with trusted bootstrap bound to the verified Auth ID and `role: user`; no client may change the role column or claim another user's profile ID. The existing auth implementation is unchanged. No Realtime or shared cross-user history cache is introduced.

See [tech-stack.md](tech-stack.md) for the V1 technology contract and [database.md](database.md) for the six implemented tables, private bucket and explicitly deferred schema.
