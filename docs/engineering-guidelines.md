# Zenote engineering guidelines

> Phase 7/8 update: use integers for credits, tokens, micro-USD, and centavos. Credits are service units, not money. Charge a successfully persisted chat by its actual gateway model, consume free credit first, and meter attachments at zero credits in V1. Ledger entries are immutable and every balance mutation shares a transaction with its ledger row.

- Use TypeScript first and preserve strict type safety.
- Inspect existing patterns before introducing structures or dependencies.
- Preserve working behavior through small, focused, maintainable changes.
- Diagnose before rewriting; avoid premature abstractions and clever code.
- Keep folders minimal and practical. Prefer flat reusable components, clear file names, and colocated route-specific code over generic architectural layers.
- Keep functions and names clear. Validate external and user-controlled input at system boundaries.
- Keep secrets, billing logic, and AI provider credentials behind server-side boundaries.
- Keep provider-specific AI logic behind abstractions so the product is not coupled to one vendor.
- Make usage and billing calculations auditable through explicit, attributable records.
- Follow existing repository conventions before creating new ones.
- Use pnpm, which is the repository's package manager.
- After meaningful changes, run the relevant existing commands: `pnpm lint`, `pnpm typecheck`, and when appropriate `pnpm build`. Add and run focused tests when the repository gains a test setup.

This repository currently uses Next.js App Router, Tailwind CSS, and shadcn/ui. Read the relevant local Next.js documentation under `node_modules/next/dist/docs/` before writing Next.js-specific code because this project uses a version with breaking changes.

## Provider isolation

- Keep provider-specific code behind the Zenote AI abstraction.
- Components must not call provider SDKs directly.
- Keep provider-specific branching out of API routes when it can live in the AI layer.
- Use Zenote model IDs at application boundaries rather than provider model IDs.

## Capability awareness

Every model/provider integration must declare its supported capabilities. Do not assume every model supports images, files, audio, tools, or reasoning. Validate the requested modality before making a provider request and preprocess unsupported attachments into normalized context instead of forcing them into a text-only API.

## Cost awareness

Each future production AI request must be traceable to its user, provider, model, tokens or other usage, provider cost, and Zenote allowance consumed. Do not implement billing metering until that work is explicitly requested.

## Secrets

- Keep all provider credentials server-only.
- Never expose AI credentials or Appwrite admin credentials to the browser.
- Never log credentials or place real values in documentation or `.env.example`.
