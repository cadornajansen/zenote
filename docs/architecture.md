# Zenote architecture

## Current repository

Zenote is a Next.js 16.2.6 App Router project using pnpm, TypeScript, Tailwind CSS 4, and shadcn/ui (Base Nova). The public site, Appwrite authentication, and authenticated chat interface are implemented. Authentication uses Appwrite Account APIs, server actions, an HTTP-only session cookie, and server-enforced protected layouts. Chat uses real AssemblyAI LLM Gateway streaming through authenticated `POST /api/chat`. Phase 2 persists users, conversations, messages, user preferences, and a mirror of the model registry in Appwrite TablesDB. Storage, durable usage accounting, and billing remain planned.

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

Appwrite Sites is Zenote's intended production hosting platform. Appwrite Auth, TablesDB, and Storage are the preferred backend services. Phase 1 implements the text AI boundary and centralized model registry. Other providers, multimodal routing, and PayMongo remain planned.

## Repository layout

```text
app/
  (public)/            # marketing and legal routes
  (auth)/              # login, signup, and password recovery
  (app)/               # protected chat and settings routes
  auth/oauth/callback/ # Google OAuth session exchange
  api/chat/            # authenticated streaming POST handler
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
  attachments.ts       # normalized attachment and AWS processor contracts only
  mock-chat.ts         # dev fixtures and type-only UI contracts; no live fixture data
  utils.ts
scripts/
  setup-appwrite.mjs   # idempotent five-table provisioning and registry seeding
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
- `lib/db.ts`: implemented TablesDB boundary for profiles, conversations/messages, and preferences; authenticated sessions enforce row permissions. Only missing-profile bootstrap uses a narrowly scoped trusted-server write.
- `lib/usage.ts`: future usage checks, consumption calculation, limit enforcement, and auditable event recording.
- `lib/billing.ts`: future PayMongo boundary, independent from provider object shapes.
- `lib/storage.ts`: future provider-independent attachment storage boundary, initially backed by Appwrite Storage when implemented.

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

Prompts put the stable system instruction first, older history next, optional trusted-processor attachment context next, then recent messages/current user input. No tools are sent. OpenAI/Gemini caching is automatic; Claude gets message-level ephemeral breakpoints on the system and older context. Fallback messages are rebuilt without unsupported cache controls. Cache hits require provider minimum lengths and are not guaranteed.

Telemetry records request IDs, requested Zenote model, actual returned provider model, available token/cache counts, latency, status, and rate-limit headers. Missing usage remains unknown, not zero. Cache writes are captured separately when returned. This is not a durable billing ledger or quota enforcement. No automatic application retries or mid-stream fallback replay are performed.

Attachments, Amazon Textract, Amazon Bedrock Nova vision, the tool registry, and a bounded tool-loop interface (`MAX_TOOL_ITERATIONS = 5`) are scaffolded only. Unprocessed attachments are blocked, not silently sent to text-only APIs. No AWS SDK, upload, tools, or agentic workflow is enabled. Future `/api/upload` and `/api/billing/webhook` routes remain planned only.

## AI verification

`pnpm test` runs deterministic Node tests against the real server/client boundaries with mocked authentication and gateway responses. It covers validation, cache structure, fallback metadata, provider failures, stream completion, and abort propagation. Live gateway streams may finish with `[DONE]` or clean EOF after a valid `finish_reason`; EOF without a finish signal is an error.

For an opt-in billable gateway smoke test, run `node --env-file=.env.local tests/live-chat.mjs` or append a Zenote model ID such as `claude-haiku-4-5`. It logs timing, usage, and model metadata, not response text or credentials. This does not replace authenticated desktop/mobile browser testing.

## Security and provider isolation

Secrets, including Appwrite API keys, AI provider credentials, AWS credentials, payment credentials, and webhook secrets remain server-only. Browser clients do not determine entitlements, prices, usage totals, provider selection, or trusted billing state. Provider fallback must preserve compatible model semantics, requested capabilities, and correct accounting; it must not silently choose expensive models without usage controls.

Conversations/messages/preferences have row security with owner-only read/update/delete ACLs and table-level authenticated create only. Queries additionally filter by the authenticated owner, and ID lookups check ownership; `userId` is not authorization. Models are authenticated-read-only and provisioner-write-only. Profiles are owner-read-only, with trusted bootstrap bound to the verified Auth ID and `role: user`; no client may change the role column or claim another user's profile ID. The existing auth implementation is unchanged. No Realtime or shared cross-user history cache is introduced.

See [tech-stack.md](tech-stack.md) for the V1 technology contract and [database.md](database.md) for the five implemented tables and the explicitly deferred schema.
