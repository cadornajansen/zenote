// Opt-in, billable smoke test. Never run as part of the deterministic test suite.
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import ts from "typescript"

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only")
      return { url: "data:text/javascript,export {}", shortCircuit: true }
    if (specifier.startsWith("@/"))
      return {
        url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href,
        shortCircuit: true,
      }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith(".ts"))
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
          },
        }).outputText,
      }
    return next(url, context)
  },
})

const { streamChat, safeChatError } = await import("../lib/ai.ts")
const { readSseData } = await import("../lib/chat.ts")
let inspection
if (process.argv.includes("--inspect-stream")) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (...args) => {
    const response = await originalFetch(...args)
    if (response.ok && response.body) {
      inspection = (async () => {
        for await (const data of readSseData(response.clone().body)) {
          if (data === "[DONE]") { console.info("terminal: [DONE]"); continue }
          const chunk = JSON.parse(data)
          if (chunk.usage || chunk.choices?.some((choice) => choice.finish_reason)) {
            console.info(JSON.stringify({ fields: Object.keys(chunk), finishReasons: chunk.choices?.map((choice) => choice.finish_reason), usagePresent: Boolean(chunk.usage) }))
          }
        }
      })()
    }
    return response
  }
}
const requestedModel = process.argv[2] ?? "gpt-5-mini"
const telemetry = {
  requestId: crypto.randomUUID(),
  requestedModel,
  status: "error",
  latencyMs: 0,
  rateLimits: {},
}
const started = Date.now()
let chunks = 0
let firstChunkMs
try {
  const stream = await streamChat(
    {
      model: requestedModel,
      messages: [
        { role: "user", content: "Reply with only: Zenote streaming works." },
      ],
    },
    AbortSignal.timeout(90_000),
    telemetry
  )
  for await (const event of stream) {
    if (event.type === "delta") {
      chunks++
      firstChunkMs ??= Date.now() - started
    }
  }
  telemetry.status = "complete"
} catch (error) {
  console.error(safeChatError(error).message)
  process.exitCode = 1
}
telemetry.latencyMs = Date.now() - started
console.info(JSON.stringify({ ...telemetry, chunks, firstChunkMs }))
await inspection
