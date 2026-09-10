# Zenote database

Phase 2 implements `users`, `conversations`, `messages`, `user_preferences`, and `models` in Appwrite TablesDB. The remaining tables below are planned only. Appwrite Auth owns identity, passwords, OAuth, and sessions; none of those credentials are duplicated in TablesDB.

## Provisioning

Use Node.js 22.18+ (Node.js 24 recommended) and the existing pnpm installation:

```sh
pnpm setup:appwrite
```

`scripts/setup-appwrite.mjs` loads `.env.local` when present. Set `NEXT_PUBLIC_APPWRITE_ENDPOINT`, `NEXT_PUBLIC_APPWRITE_PROJECT_ID`, `APPWRITE_DATABASE_ID`, and the server-only `APPWRITE_API_KEY`. Create the database explicitly in Appwrite first; setup will not silently create a database under a mistyped ID.

The provisioning key needs `databases.read`, `tables.read/write`, `columns.read/write`, `indexes.read/write`, and `rows.read/write`. Use a narrowly scoped runtime key with `sessions.write` for existing SSR authentication and `rows.write` for trusted profile bootstrap. Chat, preference, and profile reads never use the key.

Setup creates missing tables, columns, and indexes, waits for their availability, reconciles table permissions and existing profile row ACLs, and upserts the current registry models. Repeated runs are safe. It never deletes rows, tables, columns, or indexes. Incompatible existing columns/indexes cause an explicit failure requiring manual reconciliation, not destructive migration. Removed registry models are not automatically deleted; runtime routing still uses the code registry. `pnpm setup:appwrite --no-seed` skips model upserts.

## Ownership And Permissions

- All normal conversation/message/preference operations use the authenticated Appwrite session from the HTTP-only Zenote cookie, not an admin key. `lib/db.ts` resolves the Auth user independently on every request and validates inputs.
- `conversations`, `messages`, and `user_preferences` enable row security. Their only table-wide permission is `create(users)`. Every application-created row grants read/update/delete to `Role.user(authUser.$id)` only. There is no table-wide read/update/delete grant.
- `users` enables row security with no table-wide permissions and grants only owner read per row. `ensureUser` first reads with the session, then uses a narrow trusted-server creation path only if the profile is missing: Auth `$id`, Auth display name, `role: user`, owner-read-only ACL. Client profile writes are deliberately unavailable because Appwrite row permissions cannot protect the `role` column independently or enforce an Auth-derived row ID. Setup hardens existing profile ACLs without changing profile data. The role field does not currently unlock any admin feature or entitlement.
- `models` grants authenticated users table-level read only, with row security disabled and no client write permissions. Provisioning is its only writer. The UI continues to show Zenote model names, not infrastructure metadata.
- `userId` is a query filter and defense-in-depth check, never the primary authorization boundary. Conversation lookup returns the same not-found result for absent or inaccessible IDs. Message operations first authorize the parent conversation; row owner and parent IDs must also match. Session ACL enforcement still applies to direct Appwrite requests.

## Implemented Tables

All tables use Appwrite `$id`, `$createdAt`, and `$updatedAt`; no duplicate timestamp columns are created. Nullable fields are optional columns. Relationships use explicit IDs, not Appwrite relationship columns.

### `users` (implemented)

`$id` is the Appwrite Auth user ID. Columns: `displayName` varchar(128), nullable `avatarUrl` URL string, `role` enum (`user`, `admin`; default `user`). No credentials or session data.

### `conversations` (implemented)

Columns: `userId` varchar(36), `title` varchar(120), `modelId` varchar(64), nullable `systemPrompt` text, `isPinned` boolean default false, `isArchived` boolean default false, nullable `lastMessageAt` datetime.

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

## Persistence Flow

1. Entering the protected app authenticates the session, ensures its profile, and loads real sidebar conversations. `/chat` loads preferences but creates no conversation.
2. First submit atomically commits a conversation, a completed user message, and its activity timestamp in one session-authorized Appwrite transaction. The title is cleaned/truncated first-message text (60 characters); no LLM title call occurs.
3. The client replaces the URL with `/chat/{id}` using native history, keeping the mounted response UI and scroll behavior intact, then calls the existing streaming endpoint with the saved prompt ID.
4. `/api/chat` authorizes the saved conversation/user message and checks the prompt before invoking the existing gateway. SSE tokens remain transient. After successful generation, it commits one completed assistant message plus the conversation timestamp, then emits `done`. The assistant references its user prompt and has a deterministic response ID to prevent duplicate stored responses for that prompt.
5. Follow-ups persist the user prompt first and use the same streaming/save flow. Provider/save failures leave the user prompt and show the existing error state, never a fake completed answer. Stop/unmount abort upstream; aborted partial text remains UI-only and is excluded from subsequent context. Abort before the final transaction commit rolls it back. Once a complete response has committed, a late disconnect does not undo that valid stored response.
6. `/chat/[id]` restores the owned conversation and its latest 100 messages in chronological order. The sidebar loads up to 100 non-archived conversations ordered by activity, with `$updatedAt` as a fallback. Existing rename/archive/delete controls use authorized mutations; deletion removes messages in bounded batches before the parent. Refresh and login with the same Auth ID retain stored history.

UI history and AI context are bounded (100 messages; AI context also 100,000 characters). Older rows remain stored but pagination/infinite history are deferred. There is no Realtime subscription. No token-by-token Appwrite writes, additional AI calls, billing ledger, or attachment persistence.

## Verification

`pnpm test` exercises session-required access, owner checks, bounded ordering, transactional first sends and rollback, profile/preference synchronization, provisioning idempotence, and streaming completion/failure/abort boundaries with deterministic doubles. `pnpm lint`, `pnpm typecheck`, and `pnpm build` validate the application.

For an opt-in live TablesDB smoke test after setup, run `node --env-file=.env.local tests/live-db.mjs`. It creates two disposable Auth users, tests real session-authorized persistence and cross-user denial, and cleans up only its own rows/users. Its temporary-user setup/cleanup additionally needs `users.write`; it makes no billable AI calls. Browser authentication, navigation, responsive rendering, and a real provider stream still require an authenticated browser smoke test.

## Future Tables (planned, not implemented)

### `attachments`

`id`, `messageId`, `userId`, `type`, `provider`, `bucketId`, `storageKey`, `filename`, `mimeType`, `sizeBytes`, `metadata`, `createdAt`. Types: `image`, `document`, `audio`, `video`, `other`. Keep provider/bucket/key references provider-independent where practical.

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
