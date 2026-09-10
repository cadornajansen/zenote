import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { beforeEach, afterEach, test } from "node:test"
import ts from "typescript"

let user, row, calls, owned
globalThis.__attachmentUser = () => user
globalThis.__attachmentDb = {}
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only")
      return { url: "data:text/javascript,export {}", shortCircuit: true }
    if (specifier === "@/lib/auth")
      return {
        url: "data:text/javascript,export const getCurrentUser=async()=>globalThis.__attachmentUser()",
        shortCircuit: true,
      }
    if (specifier === "@/lib/db")
      return {
        url: `data:text/javascript,export class DbError extends Error {}; ${["queueAttachment", "listConversationAttachments", "getUserMessage", "createAttachment", "deleteAttachment"].map((name) => `export const ${name}=(...args)=>globalThis.__attachmentDb.${name}(...args);`).join(" ")}`,
        shortCircuit: true,
      }
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
const { loadAttachmentContext } = await import("../lib/attachments.ts")
const {
  AttachmentError,
  ATTACHMENT_LIMITS,
  ATTACHMENT_TYPES,
  boundedAttachmentText,
} = await import("../lib/attachment-policy.ts")
const { LIMITS, TYPES, boundedText } =
  await import("../functions/attachment-processor/src/policy.ts")
const { waitForAttachments } = await import("../lib/attachment-client.ts")
const route = await import("../app/api/attachments/route.ts")
const originalFetch = globalThis.fetch
const bytes = Buffer.from("Document content")
beforeEach(() => {
  user = { $id: "owner" }
  owned = true
  calls = []
  row = {
    $id: "attachment",
    userId: "owner",
    conversationId: "conversation",
    messageId: "prompt",
    fileName: "notes.txt",
    sizeBytes: bytes.length,
    kind: "document",
    status: "uploaded",
    metadata: "private hash",
    storageFileId: "private-file",
  }
  const authorize = () => {
    if (!owned)
      throw new AttachmentError("not_found", "Attachment not found.", 404)
  }
  globalThis.__attachmentDb = {
    getUserMessage: async () => authorize(),
    createAttachment: async (input) => {
      authorize()
      calls.push(["upload", input])
      return row
    },
    deleteAttachment: async () => {
      authorize()
      calls.push(["delete"])
    },
    listConversationAttachments: async () => {
      authorize()
      return [row]
    },
    queueAttachment: async () => {
      authorize()
      calls.push(["enqueue"])
      row = { ...row, status: "processing" }
      return row
    },
  }
  globalThis.fetch = async () => {
    throw new Error("Unexpected provider request")
  }
})
afterEach(() => {
  globalThis.fetch = originalFetch
})
const request = (method, name = "notes.txt", body = bytes, headers) =>
  new Request(
    `http://localhost:3000/api/attachments?conversationId=conversation&messageId=prompt&slot=0&id=attachment&name=${encodeURIComponent(name)}`,
    { method, ...(method === "POST" ? { body } : {}), headers }
  )

test("all attachment routes authenticate and deny foreign ownership before work", async () => {
  for (const method of ["POST", "PATCH", "GET", "DELETE"]) {
    user = null
    assert.equal((await route[method](request(method))).status, 401)
    user = { $id: "owner" }
    owned = false
    assert.equal((await route[method](request(method))).status, 404)
  }
  assert.equal(calls.length, 0)
})
test("upload enforces type, stream size and origin before enqueue", async () => {
  assert.equal((await route.POST(request("POST", "bad.svg"))).status, 400)
  assert.equal(
    (await route.POST(request("POST", "big.txt", Buffer.alloc(1_000_001))))
      .status,
    413
  )
  assert.equal(
    (
      await route.POST(
        request("POST", "notes.txt", bytes, {
          origin: "https://foreign.example",
        })
      )
    ).status,
    403
  )
  assert.equal(calls.length, 0)
  const response = await route.POST(
    request("POST", "notes.txt", bytes, { "content-type": "image/png" })
  )
  assert.equal(response.status, 202)
  assert.equal(calls[0][1].mimeType, "text/plain")
  assert.deepEqual(
    calls.map(([name]) => name),
    ["upload", "enqueue"]
  )
  assert.equal((await response.json()).attachment.status, "processing")
})
test("PATCH is an explicit enqueue retry, GET never enqueues or exposes private fields", async () => {
  assert.equal((await route.PATCH(request("PATCH"))).status, 202)
  row = {
    ...row,
    status: "ready",
    processedText: "Document content",
    processor: "local-text",
  }
  const response = await route.GET(request("GET"))
  const body = await response.json()
  assert.equal(body.attachments[0].status, "ready")
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.doesNotMatch(
    JSON.stringify(body),
    /processedText|Document content|storageFileId|private-file|metadata|processor/
  )
  assert.equal(calls.length, 1)
})
test("chat context gates uploaded/processing/failed current files and reuses cached history", async () => {
  for (const status of ["uploaded", "processing", "failed"]) {
    row.status = status
    await assert.rejects(
      loadAttachmentContext(
        "conversation",
        ["prompt"],
        "prompt",
        new AbortController().signal
      ),
      {
        status: status === "failed" ? 422 : 409,
        code:
          status === "failed" ? "attachment_failed" : "attachments_processing",
      }
    )
    assert.deepEqual(
      await loadAttachmentContext(
        "conversation",
        ["prompt"],
        "next",
        new AbortController().signal
      ),
      []
    )
  }
  row = { ...row, status: "ready", processedText: "cached text" }
  for (const current of ["prompt", "next"])
    assert.equal(
      (
        await loadAttachmentContext(
          "conversation",
          ["prompt"],
          current,
          new AbortController().signal
        )
      )[0].text,
      "cached text"
    )
  assert.equal(calls.length, 0)
})
test("Site and independently deployed Function policies stay identical", () => {
  assert.deepEqual(LIMITS, ATTACHMENT_LIMITS)
  for (const [ext, type] of Object.entries(ATTACHMENT_TYPES))
    assert.deepEqual(TYPES[ext], [type.mime, type.kind])
  for (const budget of [0, 1, 50, 100, 24_000])
    assert.equal(
      boundedText("x".repeat(30_000), budget),
      boundedAttachmentText("x".repeat(30_000), budget)
    )
})
test("polling resumes processing chips, uses GET only, and stops at ready", async () => {
  let requests = 0
  const updates = []
  globalThis.fetch = async (url, options) => {
    assert.match(url, /messageId=prompt/)
    assert.equal(options.cache, "no-store")
    assert.ok(!options.method || options.method === "GET")
    return Response.json({
      attachments: [
        { id: "attachment", status: ++requests === 1 ? "processing" : "ready" },
      ],
    })
  }
  await waitForAttachments(
    "conversation",
    "prompt",
    ["attachment"],
    new AbortController().signal,
    (items) => updates.push(items)
  )
  assert.equal(requests, 2)
  assert.equal(updates.at(-1)[0].status, "ready")
})
test("polling stops on failure, deletion and navigation abort without requeue", async () => {
  for (const attachments of [
    [{ id: "attachment", status: "error" }],
    [],
    [{ id: "attachment", status: "attached" }],
  ]) {
    globalThis.fetch = async () => Response.json({ attachments })
    await assert.rejects(
      waitForAttachments(
        "conversation",
        "prompt",
        ["attachment"],
        new AbortController().signal,
        () => {}
      )
    )
  }
  const controller = new AbortController()
  globalThis.fetch = async () => {
    controller.abort()
    return Response.json({
      attachments: [{ id: "attachment", status: "processing" }],
    })
  }
  await assert.rejects(
    waitForAttachments(
      "conversation",
      "prompt",
      ["attachment"],
      controller.signal,
      () => {}
    ),
    { name: "AbortError" }
  )
})

test("polling aborts a stalled request with an actionable timeout message", async (t) => {
  const timeout = new AbortController()
  t.mock.method(AbortSignal, "timeout", (milliseconds) => {
    assert.equal(milliseconds, 420_000)
    return timeout.signal
  })
  let requests = 0
  globalThis.fetch = async (_url, { signal }) => {
    requests++
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      })
      timeout.abort(new DOMException("Timed out", "TimeoutError"))
    })
  }
  await assert.rejects(
    waitForAttachments(
      "conversation",
      "prompt",
      ["attachment"],
      new AbortController().signal,
      () => {}
    ),
    /taking longer than expected.*Retry/
  )
  assert.equal(requests, 1)
})
