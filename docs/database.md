# Zenote database

Phases 2 and 3 implement `users`, `conversations`, `messages`, `user_preferences`, `models`, and `attachments` in Appwrite TablesDB, plus a private attachments Storage bucket. The remaining tables below are planned only. Appwrite Auth owns identity, passwords, OAuth, and sessions; none of those credentials are duplicated in TablesDB.

## Provisioning

Use Node.js 22.18+ (Node.js 24 recommended) and the existing pnpm installation:

```sh
pnpm setup:appwrite
```

`scripts/setup-appwrite.mjs` loads `.env.local` when present. Set `NEXT_PUBLIC_APPWRITE_ENDPOINT`, `NEXT_PUBLIC_APPWRITE_PROJECT_ID`, `APPWRITE_DATABASE_ID`, `APPWRITE_STORAGE_BUCKET_ID`, and the server-only `APPWRITE_API_KEY`. Create the database explicitly in Appwrite first; setup will not silently create a database under a mistyped ID. The dedicated Storage bucket is created if missing.

The provisioning key needs `databases.read`, `tables.read/write`, `columns.read/write`, `indexes.read/write`, `rows.read/write`, `buckets.read/write`, and `functions.read/write`. The Site runtime key needs `sessions.write`, `rows.read/write`, `files.read/write`, and `executions.write`. Normal chat/preference/profile reads use the session. Attachment reads first prove session access and ownership; only then may lifecycle mutations use the server key. Setup also provisions Function settings from `appwrite.config.json`; the official CLI deploys its code separately. The Function uses only its dynamic `x-appwrite-key` with `rows.read`, `rows.write`, `files.read`; it has no permanent admin key or client execute permission.

Setup creates missing tables, columns, and indexes, waits for their availability, reconciles table permissions and existing profile row ACLs, and upserts the current registry models. Repeated runs are safe. It never deletes rows, tables, columns, or indexes. Incompatible existing columns/indexes cause an explicit failure requiring manual reconciliation, not destructive migration. Removed registry models are not automatically deleted; runtime routing still uses the code registry. `pnpm setup:appwrite --no-seed` skips model upserts.

## Ownership And Permissions

- All normal conversation/message/preference operations use the authenticated Appwrite session from the HTTP-only Zenote cookie, not an admin key. `lib/db.ts` resolves the Auth user independently on every request and validates inputs.
- `conversations`, `messages`, and `user_preferences` enable row security. Their only table-wide permission is `create(users)`. Every application-created row grants read/update/delete to `Role.user(authUser.$id)` only. There is no table-wide read/update/delete grant.
- `users` enables row security with no table-wide permissions and grants only owner read per row. `ensureUser` first reads with the session, then uses a narrow trusted-server creation path only if the profile is missing: Auth `$id`, Auth display name, `role: user`, owner-read-only ACL. Client profile writes are deliberately unavailable because Appwrite row permissions cannot protect the `role` column independently or enforce an Auth-derived row ID. Setup hardens existing profile ACLs without changing profile data. The role field does not currently unlock any admin feature or entitlement.
- `models` grants authenticated users table-level read only, with row security disabled and no client write permissions. Provisioning is its only writer. The UI continues to show Zenote model names, not infrastructure metadata.
- `attachments` has row security and no table-wide grants. Rows and files grant only owner read. No client create/update/delete is allowed: otherwise an owner could forge processed text, provider status, file references, or another user's ownership. All writes use authenticated server endpoints with parent/message ownership checks. The dedicated bucket has `fileSecurity: true`, no bucket-wide grants, encryption/antivirus enabled, a 5 MB maximum and an extension allowlist. There are no public file URLs or tokens. Existing file/row ACLs must already be owner-read-only; inconsistent ACLs fail closed rather than being silently accepted.
- `userId` is a query filter and defense-in-depth check, never the primary authorization boundary. Conversation lookup returns the same not-found result for absent or inaccessible IDs. Message operations first authorize the parent conversation; row owner and parent IDs must also match. Session ACL enforcement still applies to direct Appwrite requests.

## Implemented Tables

All tables use Appwrite `$id`, `$createdAt`, and `$updatedAt`; no duplicate timestamp columns are created. Nullable fields are optional columns. Relationships use explicit IDs, not Appwrite relationship columns.

### `users` (implemented)

`$id` is the Appwrite Auth user ID. Columns: `displayName` varchar(128), nullable `avatarUrl` URL string, `role` enum (`user`, `admin`; default `user`). No credentials or session data.

### `conversations` (implemented)

Columns: `userId` varchar(36), `title` varchar(120), `modelId` varchar(64), nullable `systemPrompt` text, `isPinned` boolean default false, `isArchived` boolean default false, `isDeleting` boolean default false, nullable `lastMessageAt` datetime. The deletion tombstone blocks new application writes while paged cleanup runs and allows interrupted deletion to be retried.

Indexes: `userId`; `userId + lastMessageAt` (ASC/DESC); `userId + isArchived`.

### `messages` (implemented)

Columns: `conversationId` varchar(36), `userId` varchar(36), `role` enum (`user`, `assistant`, `system`, `tool`), `content` longtext, `status` enum (`pending`, `streaming`, `completed`, `failed`), nullable `parentMessageId` varchar(36).

Indexes: `conversationId`; `conversationId + $createdAt` (ASC/DESC); `userId`. The current text flow writes completed user/assistant messages only, not per-token or placeholder rows. Other schema roles/statuses are reserved, not enabled tools or agents.

### `user_preferences` (implemented)

One row per user, `$id` equal to the Auth ID. Columns: `userId` varchar(36), nullable `defaultModelId` varchar(64), nullable `customInstructions` text. Unique index: `userId`.

Model selection persists the default for new chats. Existing chats load their last-used model. `customInstructions` and conversation `systemPrompt` are stored schema fields only; this phase does not add settings controls or change AI prompt behavior. Dark appearance behavior is unchanged; no theme column is added.

### `models` (implemented)

Columns: `slug` varchar(64), `name` varchar(128), `provider` varchar(64), `providerModelId` varchar(128), nullable `description` text, booleans `supportsVision`, `supportsFiles`, `supportsTools`, `supportsReasoning`, nullable `contextWindow` integer, `isActive` boolean, `sortOrder` integer. Unique index: `slug`.

Rows mirror `lib/models.ts`, using the Zenote model ID as both `$id` and `slug`. Capabilities, provider IDs, descriptions, and order come from that registry, not another catalog. `contextWindow` is null because the registry does not declare it. Runtime routing, fallback, caching, capability checks, and the picker still use the code registry, not the database mirror. Pricing/premium columns are deferred.

### `attachments` (implemented)

Columns: `userId` varchar(36), `conversationId` varchar(36), nullable `messageId` varchar(36), `storageFileId` varchar(36), `fileName` varchar(180), `mimeType` varchar(128), `sizeBytes` integer (1..5,000,000), `kind` enum (`document`, `image`, `audio`), `status` enum (`uploaded`, `processing`, `ready`, `failed`), nullable `processor` varchar(64), nullable `processedText` longtext, nullable `errorCode` varchar(64), nullable `metadata` text. Single-column indexes: `userId`, `conversationId`, `messageId`, `status`.

Current uploads always reference a persisted owned user message; nullable `messageId` does not enable detached uploads. Metadata contains a content hash and processing lease, not arbitrary client data. A deterministic owner/message/slot ID bounds a message to four attachment slots and makes upload retries idempotent. Metadata is reserved transactionally with a parent check/touch before Storage upload so incomplete uploads remain discoverable. Failed uploads clean partial blobs; retry can reuse a completed blob or reclaim a stale partial upload. Storage and TablesDB are not one atomic transaction: a process crash during concurrent deletion/upload can still need operator reconciliation. No background cleanup service is introduced.

The Site transaction reserves `metadata.queued` before async enqueueing. Enqueue failure releases only its unclaimed reservation back to `uploaded` with `enqueue_failed`. The Function claims `metadata.lease` transactionally and only its matching lease/hash can finish. Fresh processing and ready rows are not enqueued twice. Explicit retries may reclaim processing after six minutes, longer than the Function's 300-second hard timeout; normal provider work has a two-minute cooperative deadline. Hard crashes need explicit retry, not polling-triggered replay. Ready cached text is reused without provider calls. Failures retain safe codes only. Delete removes the blob before the row; failed cleanup keeps the reference for retry. Conversation deletion tombstones the parent, removes all attachments/blobs in bounded batches, then messages and parent. Function claim/completion touches the parent transactionally so deletion conflicts rather than resurrecting rows. There is no TTL deletion of normal cached attachments.

## Chat Persistence Flow

1. Entering the protected app authenticates the session, ensures its profile, and loads real sidebar conversations. `/chat` loads preferences but creates no conversation.
2. First submit atomically commits a conversation, a completed user message, and its activity timestamp in one session-authorized Appwrite transaction. The title is cleaned/truncated first-message text (60 characters); no LLM title call occurs.
3. The client replaces the URL with `/chat/{id}` using native history, keeping the mounted response UI and scroll behavior intact, then calls the existing streaming endpoint with the saved prompt ID.
4. If files are selected, `/api/attachments` uploads bounded bytes and queues the standalone Appwrite Function. The browser polls safe GET summaries until ready before requesting generation. `/api/chat` authorizes the saved prompt/history and reads cached attachment text only. Current uploaded/processing rows return `409 attachments_processing`; failed rows return 422, without a gateway call. Ready historical context is reused. Normalized context is appended to its original user message in memory, not persisted as fake messages. SSE tokens remain transient. After successful generation, the route commits one completed assistant message plus the conversation timestamp, then emits `done`. The assistant has a deterministic response ID to prevent duplicate stored responses for that prompt.
5. Follow-ups persist the user prompt first and use the same streaming/save flow. Provider/save failures leave the user prompt and show the existing error state, never a fake completed answer. Stop/unmount abort upstream; aborted partial text remains UI-only and is excluded from subsequent context. Abort before the final transaction commit rolls it back. Once a complete response has committed, a late disconnect does not undo that valid stored response.
6. `/chat/[id]` restores the owned conversation, its latest 100 messages and attachment chip metadata in chronological order. No file bytes, processor text or credentials are serialized to the browser. Failed/stopped attachment sends can retry the saved user message without duplicate prompts or already-ready processing. The sidebar loads up to 100 non-archived conversations ordered by activity. Existing rename/archive/delete controls remain authorized. Refresh and login with the same Auth ID retain stored history.

UI history and prompt text are bounded (100 messages; 100,000 prompt characters). Attachment context has an additional total 24,000-character budget including labels/JSON escaping, prioritizing recent attachments and retaining beginnings/ends with truncation markers. Older attachment material may be omitted when the budget is exhausted. Cached extraction is also limited to 24,000 characters per file. Older rows remain stored but pagination/infinite history are deferred. There are no token-by-token writes, Realtime subscriptions, embeddings, RAG, vectors, usage/billing tables, or autonomous agents.

## Verification

`pnpm test` exercises session-required access, owner checks, bounded ordering, transactional first sends and rollback, profile/preference synchronization, provisioning idempotence, and streaming completion/failure/abort boundaries with deterministic doubles. `pnpm lint`, `pnpm typecheck`, and `pnpm build` validate the application.

For an opt-in live TablesDB smoke test after setup, run `node --env-file=.env.local tests/live-db.mjs`. It creates two disposable Auth users, tests real session-authorized persistence and cross-user denial, and cleans up only its own rows/users. Its temporary-user setup/cleanup additionally needs `users.write`; it makes no billable AI calls. Browser authentication, navigation, responsive rendering, and a real provider stream still require an authenticated browser smoke test.

## Future Tables (planned, not implemented)

### `runs`

`id`, `userId`, `conversationId`, `inputMessageId`, `outputMessageId`, `modelId`, `status`, `providerRequestId`, `startedAt`, `completedAt`, `errorCode`, `errorMessage`, `createdAt`. Statuses: `queued`, `running`, `completed`, `failed`, `cancelled`. A message is content; a run is one AI execution.

### `run_steps`

`id`, `runId`, `type`, `name`, `status`, `input`, `output`, `startedAt`, `completedAt`, `createdAt`. Planned types: `model`, `tool`, `agent`; no advanced agent features are implemented.

### `usage_events`

Append-only future ledger: `id`, `userId`, `runId`, `modelId`, `provider`, `inputTokens`, `outputTokens`, `cachedInputTokens`, `providerCostUsd`, `creditsCharged`, `createdAt`. Must eventually make usage/cost accounting auditable.

### `plans`

`id`, `slug`, `name`, `pricePhp`, `monthlyCredits`, `monthlyMessageLimit`, `isActive`, `createdAt`, `updatedAt`. Free, Plus, and Pro are conceptual; prices and limits are not locked.

### `subscriptions`

`id`, `userId`, `planId`, `provider`, `providerCustomerId`, `providerSubscriptionId`, `status`, `currentPeriodStart`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `createdAt`, `updatedAt`. Statuses: `active`, `past_due`, `cancelled`, `expired`. Keep the internal model payment-provider independent.
