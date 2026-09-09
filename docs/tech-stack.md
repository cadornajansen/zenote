# Zenote V1 technology stack

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
- **Appwrite TablesDB:** structured application data when database implementation is requested.
- **Appwrite Storage:** user attachments and files when storage implementation is requested.
- **Appwrite Functions:** only for a real isolated backend or background use case.

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

The implemented `lib/models.ts` is the single source for visible models, provider model IDs, enabled capabilities, cache policy, and one fallback:

```ts
type ModelConfig = {
  id: string
  name: string
  description: string
  provider: "assemblyai"
  providerModelId: string
  fallbackModelId: string
  caching: "automatic" | "explicit"
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

Visible models are GPT-5 Nano, GPT-5 Mini, GPT-5.6 Luna, GPT-5.6 Terra, GPT-5.6 Sol, Gemini 3.7 Flash, Claude Haiku 4.5, Claude Sonnet 5, and Claude Opus 5. Phase 1 enables streaming text only; native image/file/audio input, tool use, and explicit reasoning requests are disabled. This describes Zenote's enabled path, not every underlying model capability.

## 7. Multimodal routing

Zenote currently supports text. Images, documents, and audio remain planned; their normalized attachment and AWS processor contracts are scaffolded only. The future capability router must use native multimodal input only when the selected model supports it.

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

Processed attachment context should eventually be cached with the original file reference, `extractedText`, `extractedContext`, `processingProvider`, `processingModel`, `processingVersion`, and `processedAt`. Do not reprocess an uploaded attachment on every follow-up message. This pipeline is planned only.

## 9. Provider fallback strategy

Phase 1 uses the AssemblyAI gateway's `fallbacks` field with exactly one backup, `depth: 1`, and no extra retry. Nano falls back to Mini; Mini to Luna; Luna to Mini; Terra to Luna; Sol to Terra; Flash to Luna; Haiku to Mini; Sonnet to Terra; Opus to Sol. Actual returned model IDs are retained in server telemetry and mapped to Zenote IDs in message state when recognized. Missing model metadata remains unknown rather than claiming the selected model responded. Cross-gateway routing remains unimplemented.

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

The tracked [.env.example](../.env.example) is the complete variable template. Section comments group app, Appwrite, AI provider, payment, analytics, monitoring, email, and internal server verification configuration. Only deliberately browser-safe values use the `NEXT_PUBLIC_` prefix.

## 15. Security boundaries

Server-only secrets include Appwrite API keys, AI provider keys, AWS credentials, PayMongo secrets, Resend keys, Sentry auth tokens, and internal verification secrets. Do not expose them through `NEXT_PUBLIC_`, client modules, browser logs, documentation, or committed local environment files.

## 16. Current vs planned

Appwrite authentication and real AssemblyAI-backed streaming chat are implemented. The server gateway client uses native fetch with `ASSEMBLYAI_API_KEY` and `ASSEMBLYAI_LLM_BASE_URL` (HTTPS root including `/v1`). Appwrite conversation persistence is not implemented. Attachments/AWS/tool orchestration are scaffolded only, with no AWS SDK or active tool loop. PayMongo, PostHog, Sentry, Resend, storage, durable usage accounting, and other AI providers remain unimplemented.
