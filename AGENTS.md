<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

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

## Agent orchestration

The primary `build` agent owns implementation, code edits, final technical decisions, and final fixes. Specialized subagents exist to reduce primary-model cost and context usage.

### Roles

- `explore` — DeepSeek V4 Flash. Use for repository discovery: locating files, tracing existing implementations, finding symbols, dependencies, types, call paths, and relevant tests.
- `research` — Gemini 3.7 Flash. Use for external documentation, APIs, libraries, upstream implementations, Context7, AnySearch, and current web research.
- `architect` — GPT-5.6 Sol. Use only for difficult, ambiguous, high-impact architecture or implementation decisions where a strong second opinion materially helps.
- `test` — GPT-5 Mini. Use to run lint, typecheck, tests, and builds and diagnose verification failures. It must not edit application code.
- `review` — GLM 5 on Amazon Bedrock. Use for independent review of substantial, risky, security-sensitive, or architecture-heavy changes. It must not edit application code.

### Delegation rules

Do not delegate trivial work.

For normal implementation tasks:

1. Use `explore` when the relevant implementation or files are not already known.
2. Use `research` when correctness depends on external documentation, APIs, libraries, or current information.
3. Run independent `explore` and `research` work in parallel when both are needed.
4. Use `architect` only when the decision is genuinely difficult, ambiguous, expensive to reverse, or architecturally important.
5. The primary `build` agent decides on the implementation and performs all normal source-code edits.
6. After meaningful changes, delegate verification to `test`.
7. For substantial or risky changes, delegate an independent review to `review`.
8. The primary `build` agent evaluates subagent findings and performs any final fixes.

### Cost and context discipline

- Do not use Azure GPT-6 Astra for broad file hunting, repetitive grep/read work, generic web research, or routine test execution when a specialized subagent can do it.
- Do not invoke GPT-5.6 Sol for routine work. Reserve it for decisions that benefit from deeper architectural reasoning.
- Prefer DeepSeek `explore` for repository discovery because this work is high-volume and disposable.
- Prefer Gemini `research` for large documentation and web-research contexts.
- Prefer GPT-5 Mini for mechanical verification and failure diagnosis.
- Prefer GLM 5 as an independent second opinion rather than another implementation agent.
- Keep subagent responses concise and decision-oriented. Return relevant paths, findings, errors, and recommendations instead of dumping entire files or research transcripts.
- Avoid multiple agents independently editing the same implementation.
- Do not create agent chains when the primary agent already has enough context to solve a small task directly.

### Typical workflows

Small change:

`build → implement`

Normal coding task:

`explore → build → test`

External API/library task:

`explore + research in parallel → build → test`

Difficult architecture task:

`explore + research → architect → build → test → review → build final fixes`

Security-sensitive or high-risk task:

`explore → build → test + review → build final fixes`

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


## Zenote visual system

- Zenote is dark-only. Do not add `next-themes`, a light theme, theme toggles, or system-theme detection.
- Inspect `components/ui` first. Prefer existing shadcn/Base UI primitives and preserve their accessibility behavior.
- For visual work, use the Taste Skill and consult 21st/shadcn design resources when they solve a concrete need. Adapt every external pattern to Zenote; do not import a mismatched visual language unchanged.
- Use the dark charcoal and restrained copper token system in `app/globals.css`. Avoid generic AI-generated SaaS patterns such as bento overload, fake social proof, excessive pills, rainbow gradients, and decorative glass.

### Research tool discipline

- Prefer Context7 for framework, SDK, and library documentation.
- Use AnySearch for discovery and extraction.
- If `anysearch_extract` fails once for a URL, do not retry it repeatedly; use `webfetch` instead.
- Prefer official documentation and upstream repositories.
- Avoid issuing several near-identical searches for the same question.
- Stop researching once enough authoritative evidence exists.

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**This project has a knowledge graph. Start with the code-review-graph
MCP tools to narrow scope, then read the source.** The graph is cheaper than scanning files and
gives you structural context (callers, dependents, test coverage) that file search cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

### Verify in the source

- Narrow scope with the graph, then read the source. Do not change code from graph output alone.
- For any non-trivial change, read the implementation and the relevant tests before concluding.
- Verify the exact source when touching behavior, database logic, migrations, retries, fallbacks,
  recovery, or compatibility code.
- When the graph and the source disagree, the source wins. The graph may be stale or may not
  model that relationship.
- An empty graph result can mean "not indexed" or "not statically visible", not "does not exist".

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes_tool` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context_tool` | Need source snippets for review — token-efficient |
| `get_impact_radius_tool` | Understanding blast radius of a change |
| `get_affected_flows_tool` | Finding which execution paths are impacted |
| `query_graph_tool` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes_tool` | Finding functions/classes by name or keyword |
| `get_architecture_overview_tool` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
<!-- /code-review-graph MCP tools -->
