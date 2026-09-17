# Zenote V1 technology stack

> Phase 7/8 update: PayMongo Hosted Checkout v2 restricted to QR Ph is the sole V1 payment rail. It is called with native server `fetch` and verified with Node `crypto`; no browser payment SDK or public payment key is used.

## 1. Overview

Zenote is a commercial AI chat SaaS. This document locks its intended V1 infrastructure direction without authorizing implementation of unbuilt integrations. Keep the product focused on AI chat, multimodal input, model choice, streaming, history, authentication, usage limits, subscriptions, PHP pricing, and Philippine-friendly payments.

## 2. Application stack

- **Framework:** Next.js 16 App Router.
- **Language:** TypeScript.
- **Styling:** Tailwind CSS 4.
- **UI:** shadcn/ui (Base Nova configuration).
- **Package manager:** pnpm.

## 3. Appwrite platform

Appwrite is Zenote's primary backend platform:

- **Appwrite Sites:** production hosting.
- **Appwrite Auth:** authentication and identity/password management.
- **Appwrite TablesDB:** implemented profiles, conversations/messages, preferences, model mirror and attachments.
- **Appwrite Storage:** implemented private owner-readable attachment files; server-only writes.
- **Appwrite Functions:** one asynchronous TypeScript/Node 22 `attachment-processor`, locally compiled to `dist/main.js` and isolated from the Site.

Do not introduce Vercel as Zenote's production hosting platform, another primary database, Supabase, or Postgres without explicit direction.

## 4. AI architecture

```text
Zenote UI
   ↓
Zenote AI layer
   ↓
Model Registry
   ↓
Capability Router
   ├── AssemblyAI LLM Gateway
   ├── Azure AI
   ├── Amazon Bedrock
   └── OpenRouter
```

The UI and product logic use Zenote model IDs from `lib/models.ts`, such as `gpt-5-mini` and `gpt-5-6-luna`. Provider model IDs are registry metadata, never hard-coded in routes or components. The UI does not display gateway infrastructure names.

## 5. AI provider responsibilities

- **AssemblyAI LLM Gateway:** preferred primary gateway for supported text AI requests. Use AssemblyAI speech-to-text for audio where appropriate. Do not send native image/file structures it does not support.
- **Azure AI:** premium or multimodal models, direct provider access, and provider diversity.
- **Amazon Bedrock:** Claude where appropriate, Amazon Nova and other supported models, multimodal models, and provider diversity.
- **OpenRouter:** broad, experimental, inexpensive, fallback, and appropriate free-model access. It is not Zenote's only provider; paid-plan reliability must not depend entirely on free models.

## 6. Model registry

The implemented `lib/models.ts` is the single source for visible models, provider model IDs, enabled capabilities, cache policy, credit weight, and one fallback:

```ts
type ModelConfig = {
  id: string
  name: string
  description: string
  provider: "assemblyai"
  providerModelId: string
  fallbackModelId: string
  caching: "automatic" | "explicit"
  creditWeight: number
  capabilities: {
    text: boolean
    streaming: boolean
    image: boolean
    files: boolean
    audio: boolean
    tools: boolean
    reasoning: boolean
  }
}
```

Visible models are GPT-6 Astra, GPT-5 Nano, GPT-5 Mini, GPT-5.6 Luna, GPT-5.6 Terra, GPT-5.6 Sol, Gemini 3.7 Flash, Claude Haiku 4.5, Claude Sonnet 5, and Claude Opus 5. Phase 1 enables streaming text only; native image/file/audio input, tool use, and explicit reasoning requests are disabled. This describes Zenote's enabled path, not every underlying model capability.

## 7. Multimodal routing

Zenote supports text plus preprocessed images, documents and audio. Current visible models still declare native image/file/audio support false: attachments are normalized into bounded text before the existing gateway call. Native multimodal chat requests remain deferred and must never bypass capability checks.

```text
Incoming request
      ↓
Capability Router
      ↓
Does selected model support this modality natively?
      ├── yes → send native multimodal request
      └── no → preprocess attachment → normalized context → text-capable model
```

## 8. Attachment preprocessing

For an image with a text-only AssemblyAI-backed model, use a vision-capable provider to create normalized context such as an image description, visible text, and important details before the AssemblyAI request. Never force unsupported image/file data into the gateway.

For documents, use local or server-side deterministic text extraction for PDF, DOCX, and TXT where possible. If a scanned or image-only document has insufficient extracted text, use a vision/OCR-capable provider to produce normalized context. Do not pay an AI model for deterministic extraction.

For audio, use AssemblyAI speech-to-text, then pass the transcript through the Zenote AI layer.

Phase 3 caches `processedText`, `processor`, status and a safe error code alongside the private file reference in `attachments`. Appwrite timestamps and a small content-hash/lease metadata field avoid duplicate schema fields. Follow-ups reuse ready text. Four files are allowed per message: TXT/MD up to 1 MB, PNG/JPEG/WebP up to 3.5 MB and 8,000 pixels per edge, DOCX/PDF/audio up to 5 MB. Audio formats are MP3/WAV/FLAC/OGG. Filenames, sizes and content signatures are server-validated; SVG, video, arbitrary URLs and unsupported archives are rejected.

Mammoth, pdf-parse, fflate (DOCX ZIP preflight), sharp (image validation), and both AWS SDK clients belong exclusively to the independently installed `functions/attachment-processor` package. PDF sampling is at most 50 pages (first 45 and last five for longer files); DOCX expansion is at most 20 MB/500 entries. Parsing runs directly in the Appwrite Function, not a Next subprocess; the Site has no parser tracing or external-package configuration. Images use Textract `AnalyzeDocument` with layout/table/form features, then sequential primary and verification Nova vision calls with 8,192 output tokens each. `BEDROCK_NOVA_VISION_MODEL_ID` selects an invocable multimodal inference profile and falls back to the legacy `BEDROCK_NOVA_MODEL_ID`; the active `global.amazon.nova-2-lite-v1:0` profile is the code default because Nova Premier is legacy and near EOL. OCR, structured data, and verified visual evidence are deterministically assembled within 24k characters with graceful stage degradation. The unchanged synchronous `DetectDocumentText` path is used only for empty single-page PDFs; unsupported scans fail rather than create asynchronous OCR jobs. AssemblyAI STT uses native fetch and the existing key; its transcript is deleted best-effort after processing. Provider retention still applies to ambiguous submissions/cleanup failures.

Cached text and total injected attachment context are separately bounded to 24,000 characters. Attachment-derived text is untrusted reference data, not instructions, including model-generated image descriptions. No embedding, retrieval, RAG, vector database, tools, autonomous agent, billing ledger or usage table is added.

## 9. Provider fallback strategy

Phase 1 uses the AssemblyAI gateway's `fallbacks` field with exactly one backup, `depth: 1`, and no extra retry. Astra falls back to Sol; Nano falls back to Mini; Mini to Luna; Luna to Mini; Terra to Luna; Sol to Terra; Flash to Luna; Haiku to Mini; Sonnet to Terra; Opus to Sol. Actual returned model IDs are retained in server telemetry and mapped to Zenote IDs in message state when recognized. Missing model metadata remains unknown rather than claiming the selected model responded. Cross-gateway routing remains unimplemented.

OpenAI and Gemini use automatic prompt caching. Claude uses supported message-level ephemeral cache controls on stable context; fallback message overrides remove those controls for OpenAI. Cache usage and cache writes are recorded when supplied by the stream, without estimating missing token counts. Durable accounting, entitlements, and billing limits are not implemented and are required before unrestricted paid-product rollout.

## 10. Payments

PayMongo is the primary payment provider. Expected supported methods include GCash, Maya, cards, and QRPh where PayMongo supports them. Zenote's internal subscriptions and billing model must remain independent from PayMongo-specific objects. Payment credentials stay server-side.

## 11. Analytics

Use PostHog for product analytics when analytics is implemented. Do not add heavy observability infrastructure.

## 12. Monitoring

Use Sentry for error monitoring when monitoring is implemented.

## 13. Email

Use Resend for transactional email when needed, including welcome emails, subscription events, usage warnings, and account notifications.

## 14. Environment configuration

The tracked [.env.example](../.env.example) is the complete variable template. [attachment-processing.md](attachment-processing.md) assigns variables to the Site, Function or shared project. Function runtime authentication uses the injected endpoint/project and dynamic key, never a copied Site key. Only deliberately browser-safe values use the `NEXT_PUBLIC_` prefix.

## 15. Security boundaries

Server-only secrets include Appwrite API keys, AI provider keys, AWS credentials, PayMongo secrets, Resend keys, Sentry auth tokens, and internal verification secrets. Do not expose them through `NEXT_PUBLIC_`, client modules, browser logs, documentation, or committed local environment files.

## 16. Current vs planned

Appwrite authentication, persisted conversations, private attachment storage, cached multimodal preprocessing, and AssemblyAI-backed streaming chat are implemented. The AssemblyAI gateway client uses native fetch with `ASSEMBLYAI_API_KEY` and `ASSEMBLYAI_LLM_BASE_URL` (HTTPS root including `/v1`). AWS Nova/Textract are internal preprocessing paths, not extra picker models. There is no active tool loop. PayMongo, PostHog, Sentry, Resend, durable usage accounting, rate/quota enforcement and additional chat gateways (Amazon Bedrock, OpenRouter) remain unimplemented and must be addressed before unrestricted paid-product rollout.
