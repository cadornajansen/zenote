import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { test } from "node:test"
import handler, { runAttachment } from "../dist/main.js"
import { ProcessingError } from "../dist/policy.js"

// Revisions are captured on first staged write, not on initial read.
function fixture() {
  const bytes = Buffer.from("Private document text")
  const row = {
    $id: "attachment",
    $permissions: ['read("user:owner")'],
    userId: "owner",
    conversationId: "conversation",
    messageId: "message",
    storageFileId: "attachment",
    fileName: "notes.txt",
    mimeType: "text/plain",
    kind: "document",
    sizeBytes: bytes.length,
    status: "processing",
    metadata: JSON.stringify({
      hash: createHash("sha256").update(bytes).digest("hex"),
      queued: "attempt",
    }),
  }
  const state = {
    attachments: row,
    conversations: { $id: "conversation", userId: "owner", isDeleting: false },
    messages: {
      $id: "message",
      userId: "owner",
      conversationId: "conversation",
      role: "user",
      status: "completed",
    },
  }
  let version = 0,
    next = 0,
    downloads = 0
  const transactions = new Map(),
    logs = []
  const file = {
    $id: "attachment",
    name: "notes.txt",
    sizeOriginal: bytes.length,
    chunksUploaded: 1,
    chunksTotal: 1,
    $permissions: row.$permissions,
  }
  const tablesDB = {
    async createTransaction() {
      const $id = String(++next)
      transactions.set($id, {})
      return { $id }
    },
    async getRow({ tableId, transactionId }) {
      const value = (transactions.get(transactionId).state ?? state)[tableId]
      if (!value) throw Object.assign(new Error("missing"), { code: 404 })
      return structuredClone(value)
    },
    async updateRow({ tableId, transactionId, data }) {
      const tx = transactions.get(transactionId)
      if (!tx.state) Object.assign(tx, { version, state: structuredClone(state) })
      const draft = tx.state
      draft[tableId] = { ...draft[tableId], ...data }
      return structuredClone(draft[tableId])
    },
    async updateTransaction({ transactionId, commit }) {
      if (commit) {
        const tx = transactions.get(transactionId)
        if (tx.version !== version)
          throw Object.assign(new Error("conflict"), { code: 409 })
        Object.assign(state, tx.state)
        version++
      }
      transactions.delete(transactionId)
    },
  }
  const storage = {
    async getFile() {
      return file
    },
    async getFileDownload() {
      downloads++
      return bytes
    },
  }
  return {
    state,
    file,
    bytes,
    logs,
    tablesDB,
    storage,
    get downloads() {
      return downloads
    },
    dependencies: {
      tablesDB,
      storage,
      databaseId: "database",
      bucketId: "bucket",
      tableId: "attachments",
      log: (value) => logs.push(value),
      encryptAttachmentText: async (_tablesDB, _databaseId, _userId, _attachmentId, text) => `zenc:test:${text}`,
    },
  }
}

test("a trusted queued row downloads, processes, caches and clears its lease", async () => {
  const f = fixture()
  assert.deepEqual(await runAttachment("attachment", f.dependencies), {
    status: "ready",
  })
  assert.equal(f.state.attachments.processedText, "zenc:test:Private document text")
  assert.equal(f.state.attachments.processor, "local-text")
  assert.deepEqual(Object.keys(JSON.parse(f.state.attachments.metadata)), [
    "hash",
  ])
  assert.doesNotMatch(
    f.logs.join(""),
    /Private document text|notes.txt|user:owner/
  )
})

test("malformed stored metadata fails closed with a typed error before download", async () => {
  for (const metadata of ["{", "null", "[]", '{"hash":123}']) {
    const f = fixture()
    f.state.attachments.metadata = metadata
    await assert.rejects(runAttachment("attachment", f.dependencies), {
      code: "invalid_state",
    })
    assert.equal(f.downloads, 0)
    assert.equal(f.state.attachments.status, "processing")
  }
})
test("an execution delayed beyond admission expiry cannot start provider work", async () => {
  const f = fixture()
  f.state.attachments.metadata = JSON.stringify({
    ...JSON.parse(f.state.attachments.metadata), admissionExpiresAt: Date.now() - 1,
  })
  let invoked = 0
  assert.deepEqual(await runAttachment("attachment", f.dependencies, async () => { invoked++; throw new Error("must not run") }), { status: "noop" })
  assert.equal(invoked, 0)
  assert.equal(f.downloads, 0)
})
test("a competing claim between read and first staged write cannot invoke a second provider", async () => {
  const f = fixture()
  const get = f.tablesDB.getRow
  let first = true
  f.tablesDB.getRow = async (p) => {
    const row = await get(p)
    if (p.tableId === "attachments" && first) {
      first = false
      f.state.attachments.metadata = JSON.stringify({
        ...JSON.parse(f.state.attachments.metadata), lease: "competing-worker",
      })
    }
    return row
  }
  let invoked = 0
  assert.deepEqual(await runAttachment("attachment", f.dependencies, async () => { invoked++; throw new Error("must not run") }), { status: "noop" })
  assert.equal(invoked, 0)
})
test("simultaneous and repeated executions perform processing at most once", async () => {
  const f = fixture()
  let processed = 0
  const process = async () => {
    processed++
    return { text: "cached", processor: "test" }
  }
  const results = await Promise.all([
    runAttachment("attachment", f.dependencies, process),
    runAttachment("attachment", f.dependencies, process),
  ])
  assert.deepEqual(results.map((r) => r.status).sort(), ["noop", "ready"])
  assert.deepEqual(await runAttachment("attachment", f.dependencies, process), {
    status: "noop",
  })
  assert.equal(processed, 1)
  assert.equal(f.downloads, 1)
})
test("failed jobs require a new Site reservation; delayed executions cannot retry providers", async () => {
  const f = fixture()
  let processed = 0
  const process = async () => {
    processed++
    throw new ProcessingError("empty_text")
  }
  assert.deepEqual(await runAttachment("attachment", f.dependencies, process), {
    status: "failed",
    code: "empty_text",
  })
  assert.equal(f.state.attachments.processedText, null)
  await runAttachment("attachment", f.dependencies, process)
  assert.equal(processed, 1)
  f.state.attachments.status = "processing"
  f.state.attachments.metadata = JSON.stringify({
    ...JSON.parse(f.state.attachments.metadata),
    queued: "explicit-retry",
  })
  assert.equal(
    (await runAttachment("attachment", f.dependencies)).status,
    "ready"
  )
})
test("a superseded lease cannot publish success or failure over a newer attempt", async () => {
  const f = fixture()
  await assert.rejects(
    runAttachment("attachment", f.dependencies, async () => {
      f.state.attachments.metadata = JSON.stringify({
        ...JSON.parse(f.state.attachments.metadata),
        lease: "new-worker",
      })
      return { text: "stale output", processor: "test" }
    }),
    { code: "state_write_failed" }
  )
  assert.equal(f.state.attachments.processedText, undefined)
  assert.equal(JSON.parse(f.state.attachments.metadata).lease, "new-worker")
})
test("conversation tombstone or attachment removal during work prevents resurrection", async () => {
  for (const remove of [false, true]) {
    const f = fixture()
    await assert.rejects(
      runAttachment("attachment", f.dependencies, async () => {
        if (remove) delete f.state.attachments
        else f.state.conversations.isDeleting = true
        return { text: "must not persist", processor: "test" }
      }),
      { code: "state_write_failed" }
    )
    assert.equal(f.state.attachments?.processedText, undefined)
  }
})
test("invalid ownership, ACLs, message linkage, metadata and tombstones reject before download", async () => {
  const mutations = [
    (f) => {
      f.state.attachments.userId = "other"
    },
    (f) => {
      f.state.attachments.$permissions = ['read("any")']
    },
    (f) => {
      f.state.attachments.storageFileId = "other"
    },
    (f) => {
      f.state.attachments.messageId = null
    },
    (f) => {
      f.state.messages.userId = "other"
    },
    (f) => {
      f.state.messages.conversationId = "other"
    },
    (f) => {
      f.state.messages.role = "assistant"
    },
    (f) => {
      f.state.messages.status = "streaming"
    },
    (f) => {
      f.state.conversations.isDeleting = true
    },
    (f) => {
      f.state.attachments.mimeType = "image/png"
    },
    (f) => {
      f.state.attachments.metadata = "{}"
    },
    (f) => {
      f.state.attachments.sizeBytes = 1_000_001
    },
  ]
  for (const mutate of mutations) {
    const f = fixture()
    mutate(f)
    await assert.rejects(runAttachment("attachment", f.dependencies))
    assert.equal(f.downloads, 0)
  }
})
test("hash, file metadata, partial uploads and file permissions fail closed", async () => {
  for (const mutate of [
    (f) => {
      f.bytes[0] = 0
    },
    (f) => {
      f.file.$id = "other"
    },
    (f) => {
      f.file.name = "other.txt"
    },
    (f) => {
      f.file.sizeOriginal++
    },
    (f) => {
      f.file.chunksUploaded = 0
    },
    (f) => {
      f.file.$permissions = ['read("any")']
    },
  ]) {
    const f = fixture()
    mutate(f)
    let processed = false
    assert.equal(
      (
        await runAttachment("attachment", f.dependencies, async () => {
          processed = true
        })
      ).status,
      "failed"
    )
    assert.equal(processed, false)
    assert.equal(f.state.attachments.processedText, null)
  }
})
test("provider failures persist only a safe error code and never provider response bodies", async () => {
  const f = fixture()
  assert.deepEqual(
    await runAttachment("attachment", f.dependencies, async () => {
      throw new Error("secret key and provider body")
    }),
    { status: "failed", code: "processing_failed" }
  )
  assert.doesNotMatch(
    JSON.stringify(f.state) + f.logs.join(""),
    /secret key|provider body/
  )
})
test("missing rows and already claimed attempts are safe no-ops", async () => {
  const f = fixture()
  f.state.attachments.metadata = JSON.stringify({
    ...JSON.parse(f.state.attachments.metadata),
    lease: "existing",
  })
  assert.equal(
    (await runAttachment("attachment", f.dependencies)).status,
    "noop"
  )
  delete f.state.attachments
  assert.equal(
    (await runAttachment("attachment", f.dependencies)).status,
    "noop"
  )
  assert.equal(f.downloads, 0)
})
test("Function rejects all payloads except a sole valid attachmentId, without echoing input", async () => {
  for (const bodyJson of [
    null,
    [],
    {},
    { attachmentId: "../secret" },
    { attachmentId: "attachment", userId: "forged" },
    { attachmentId: "attachment", url: "https://evil" },
  ]) {
    const result = await handler({
      req: { method: "POST", bodyJson },
      res: { json: (body, status) => ({ body, status }) },
      log() {},
      error() {},
    })
    assert.equal(result.status, 400)
    assert.deepEqual(result.body, { status: "failed", code: "invalid_request" })
  }
})
