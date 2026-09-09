# Zenote agent instructions

Zenote is a polished commercial AI chat SaaS. Its current product focus is a familiar ChatGPT-style chat experience, not a broad productivity or agent platform.

## Product understanding

- Before making a major product change, read the relevant files in `docs/`, especially [docs/product-context.md](docs/product-context.md) and [docs/product-scope.md](docs/product-scope.md).
- Stay within the documented current scope. Do not enlarge the product without explicit instruction.
- Treat Zenote primarily as a polished AI chat SaaS.

## Engineering behavior

- Inspect the existing implementation and diagnose a problem before changing code.
- Preserve working behavior and make the smallest maintainable change that solves the task.
- Follow repository conventions and keep changes production-quality.
- Avoid premature abstractions, new libraries, and new infrastructure unless there is a clear need.
- Keep the folder structure minimal. Prefer clear, colocated route code and a small number of direct application boundaries over architectural layers.
- Prefer clear code over clever code. Validate external and user input.
- Keep secrets and provider credentials on the server.
- Keep provider-specific AI logic behind server-side abstractions.
- Make usage and billing calculations auditable.

## UI behavior

For every UI task:

1. Inspect `components/ui` first.
2. Reuse an existing shadcn/ui component whenever appropriate.
3. When a new shadcn primitive is needed, use the available shadcn skills or tooling to add the official component when possible.
4. Do not build a custom version of a shadcn primitive without a concrete reason.
5. Preserve accessibility behavior and keep the design minimal, cohesive, and consistent with the existing application.

## AI and provider behavior

- Never expose API keys in client code, browser bundles, logs, or error messages.
- Handle streaming failures, provider errors, rate limits, and usage accounting deliberately.
- Record usage accurately: Zenote is a paid product.
- Do not hard-code the application around a single AI vendor.

## Technology stack

- Appwrite is Zenote's primary infrastructure platform: Appwrite Sites hosts production, while Appwrite Auth, TablesDB, and Storage are the preferred backend services.
- Zenote supports multiple AI providers. AssemblyAI, Azure AI, Amazon Bedrock, and OpenRouter must remain behind the Zenote AI abstraction.
- Use Zenote model IDs at application boundaries and check a model's declared capability before sending images, files, audio, tools, or reasoning requests.
- Unsupported attachments must be preprocessed into normalized context; never force them into a text-only provider API.
- Do not introduce another infrastructure provider without a concrete reason.
- Keep `.env.example` synchronized whenever environment requirements change. Provider and Appwrite admin credentials must never reach client code.

## Scope discipline

Do not independently add autonomous agents, RAG, vector databases, workflows, automations, collaborative workspaces, complex organizations or teams, or unrelated productivity tools. They are outside Zenote's current scope.

`docs/database.md` describes the planned schema only. Do not implement or modify the database unless the task explicitly requests database implementation.

## Before completing work

1. Verify the requested behavior.
2. Check affected existing behavior for regressions.
3. Run the relevant existing lint, typecheck, test, and/or build command after meaningful changes.
4. Summarize only meaningful implementation changes.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Zenote visual system

- Zenote is dark-only. Do not add `next-themes`, a light theme, theme toggles, or system-theme detection.
- Inspect `components/ui` first. Prefer existing shadcn/Base UI primitives and preserve their accessibility behavior.
- For visual work, use the Taste Skill and consult 21st/shadcn design resources when they solve a concrete need. Adapt every external pattern to Zenote; do not import a mismatched visual language unchanged.
- Use the dark charcoal and restrained copper token system in `app/globals.css`. Avoid generic AI-generated SaaS patterns such as bento overload, fake social proof, excessive pills, rainbow gradients, and decorative glass.
