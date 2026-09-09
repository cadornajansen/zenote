# Zenote architecture

## Current repository

Zenote is a Next.js 16.2.6 App Router project using pnpm, TypeScript, Tailwind CSS 4, and shadcn/ui (Base Nova). The public site, Appwrite authentication, and authenticated chat interface are implemented. Authentication uses Appwrite Account APIs, server actions, an HTTP-only session cookie, and server-enforced protected layouts. Chat now uses real AssemblyAI LLM Gateway streaming through authenticated `POST /api/chat`. Conversation state is client-local; sidebar/history fixtures remain. Appwrite conversation persistence, TablesDB, Storage, and billing are not implemented.

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
  ai.ts                # server-only gateway, context, telemetry, tool contracts
  models.ts            # centralized model IDs, capabilities, caching, fallbacks
  chat.ts              # browser transport, shared messages and SSE framing
  attachments.ts       # normalized attachment and AWS processor contracts only
  mock-chat.ts         # temporary local history fixtures and UI-compatible types
  utils.ts
docs/
```

Route groups organize code without appearing in URLs. The public layout resolves optional auth state for its navbar. The `(app)` layout resolves the current Appwrite user on the server and redirects unauthenticated requests before rendering protected content.

Use `(public)` for marketing/legal routes, `(auth)` for account entry and recovery, and `(app)` for authenticated product routes. The `(app)` layout owns the responsive sidebar shell. `/chat` and `/chat/[id]` share one client workspace with real, abortable idle-to-thinking-to-streaming responses. `/chat/[id]` still loads fixture history, not saved conversations.

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
- `lib/db.ts`: future Appwrite TablesDB operations only when database implementation is explicitly requested.
- `lib/usage.ts`: future usage checks, consumption calculation, limit enforcement, and auditable event recording.
- `lib/billing.ts`: future PayMongo boundary, independent from provider object shapes.
- `lib/storage.ts`: future provider-independent attachment storage boundary, initially backed by Appwrite Storage when implemented.

`types/` is reserved for shared types only when an implemented boundary needs them. Do not create empty type declarations or fake implementations.

## Phase 1 request flow

```text
Chat UI
   ↓
POST /api/chat
   ↓
authenticate
   ↓
validate model and bounded client message history
   ↓
build stable context and call AssemblyAI with one fallback
   ↓
normalize SSE deltas, actual model metadata, and safe errors
   ↓
stream response to existing chat UI (abort propagates upstream)
   ↓
log structured completion/error/abort telemetry, without prompts
```

This text flow is implemented. `buildConversationContext` takes normalized user/assistant messages; a future DB history reader can supply the same boundary. Client system/tool roles are rejected. Input size, message count, text capabilities, and output length are bounded. Requests time out after three minutes. Failed/truncated streams are not marked complete; partial text is retained. Stop and unmount cancel the upstream request.

Prompts put the stable system instruction first, older history next, optional trusted-processor attachment context next, then recent messages/current user input. No tools are sent. OpenAI/Gemini caching is automatic; Claude gets message-level ephemeral breakpoints on the system and older context. Fallback messages are rebuilt without unsupported cache controls. Cache hits require provider minimum lengths and are not guaranteed.

Telemetry records request IDs, requested Zenote model, actual returned provider model, available token/cache counts, latency, status, and rate-limit headers. Missing usage remains unknown, not zero. Cache writes are captured separately when returned. This is not a durable billing ledger or quota enforcement. No automatic application retries or mid-stream fallback replay are performed.

Attachments, Amazon Textract, Amazon Bedrock Nova vision, the tool registry, and a bounded tool-loop interface (`MAX_TOOL_ITERATIONS = 5`) are scaffolded only. Unprocessed attachments are blocked, not silently sent to text-only APIs. No AWS SDK, upload, tools, or agentic workflow is enabled. Future `/api/upload` and `/api/billing/webhook` routes remain planned only.

## AI verification

`pnpm test` runs deterministic Node tests against the real server/client boundaries with mocked authentication and gateway responses. It covers validation, cache structure, fallback metadata, provider failures, stream completion, and abort propagation. Live gateway streams may finish with `[DONE]` or clean EOF after a valid `finish_reason`; EOF without a finish signal is an error.

For an opt-in billable gateway smoke test, run `node --env-file=.env.local tests/live-chat.mjs` or append a Zenote model ID such as `claude-haiku-4-5`. It logs timing, usage, and model metadata, not response text or credentials. This does not replace authenticated desktop/mobile browser testing.

## Security and provider isolation

Secrets, including Appwrite API keys, AI provider credentials, AWS credentials, payment credentials, and webhook secrets remain server-only. Browser clients do not determine entitlements, prices, usage totals, provider selection, or trusted billing state. Provider fallback must preserve compatible model semantics, requested capabilities, and correct accounting; it must not silently choose expensive models without usage controls.

See [tech-stack.md](tech-stack.md) for the V1 technology contract and [database.md](database.md) for the planned database schema. The database document is documentation only and does not authorize Appwrite schema implementation.
