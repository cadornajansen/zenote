import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import { registerHooks } from "node:module"
import { test, beforeEach } from "node:test"
import { AppwriteException, Client, TablesDB } from "node-appwrite"
import ts from "typescript"
import { admissionStore } from "./admission-store.mjs"

let client
globalThis.__dbSession = () => client
globalThis.__dbAdmin = () => ({
  tablesDB: {
    createRow: async (input) => {
      calls.push(["admin-create", input])
      return { $id: input.rowId, ...input.data }
    },
  },
})
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only")
      return { url: "data:text/javascript,export {}", shortCircuit: true }
    if (specifier === "@/lib/appwrite-server")
      return {
        url: "data:text/javascript,export const createSessionClient=async()=>globalThis.__dbSession(); export const createAdminServerClient=()=>globalThis.__dbAdmin(); export const createExecutionServerClient=()=>globalThis.__dbAdmin()",
        shortCircuit: true,
      }
    if (specifier === "@/lib/content-crypto")
      return {
        url: "data:text/javascript,export const encryptContent=async(_location,value)=>'zenc:'+value;export const decryptContent=async(_location,value)=>typeof value==='string'&&value.startsWith('zenc:')?value.slice(5):value",
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
const db = await import("../lib/db.ts")
const { savePromptAction } = await import("../app/(app)/chat/actions.ts")
const {
  schema,
  provision,
  provisionStorage,
  provisionAttachmentFunction,
  setupFailureMessage,
} = await import("../scripts/setup-appwrite.mjs")
const { models } = await import("../lib/models.ts")
let calls
const owned = { $id: "conversation", userId: "owner", modelId: "gpt-5-mini" }
beforeEach(() => {
  delete owned.isDeleting
  calls = []
  process.env.APPWRITE_DATABASE_ID = "test-database"
  client = {
    account: { get: async () => ({ $id: "owner", name: "Owner" }) },
    tablesDB: {
      getRow: async (input) => {
        calls.push(["get", input])
        return { ...owned }
      },
      listRows: async (input) => {
        calls.push(["list", input])
        return { rows: [] }
      },
      createTransaction: async () => ({ $id: "transaction" }),
      updateTransaction: async (input) => {
        calls.push(["transaction", input])
      },
      createRow: async (input) => {
        calls.push(["create", input])
        return {
          $id: input.rowId,
          $createdAt: "2026-09-10T10:00:00.000Z",
          ...input.data,
        }
      },
      updateRow: async (input) => {
        calls.push(["update", input])
        return { ...owned, ...input.data }
      },
      upsertRow: async (input) => {
        calls.push(["upsert", input])
        return input
      },
      deleteRow: async (input) => {
        calls.push(["delete", input])
      },
    },
  }
})

test("all normal database operations require an authenticated session", async () => {
  client = null
  await assert.rejects(db.listConversations(), { status: 401 })
  await assert.rejects(db.createConversation("Hello", "gpt-5-mini"), {
    status: 401,
  })
})

test("conversation rows from the real SDK are plain objects at the React boundary", async (t) => {
  const row = {
    ...owned,
    title: "Hello",
    lastMessageAt: null,
    $updatedAt: "2026-09-10T10:00:00.000Z",
    $permissions: ['read("user:owner")'],
  }
  const server = createServer((_request, response) => {
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ total: 1, rows: [row] }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  client.tablesDB = new TablesDB(
    new Client()
      .setEndpoint(`http://127.0.0.1:${server.address().port}/v1`)
      .setProject("test-project")
      .setSession("test-session")
  )
  const raw = await client.tablesDB.listRows({
    databaseId: "test-database",
    tableId: "conversations",
  })
  assert.equal(Object.getPrototypeOf(raw.rows[0]), null)
  const conversations = await db.listConversations()
  assert.equal(Object.getPrototypeOf(conversations[0]), Object.prototype)
  assert.deepEqual(conversations, [row])
})

test("first-send and follow-up actions return plain conversation and message objects", async () => {
  for (const method of ["createRow", "updateRow"]) {
    const original = client.tablesDB[method]
    client.tablesDB[method] = async (input) =>
      Object.assign(Object.create(null), await original(input))
  }
  for (const conversationId of [undefined, "conversation"]) {
    const saved = await savePromptAction({
      conversationId,
      modelId: "gpt-5-mini",
      content: "Hello",
    })
    assert.equal(saved.error, undefined)
    assert.equal(Object.getPrototypeOf(saved.conversation), Object.prototype)
    assert.equal(Object.getPrototypeOf(saved.message), Object.prototype)
    assert.equal(saved.message.content, "Hello")
    assert.equal(saved.message.status, "completed")
    assert.equal(saved.conversation.lastMessageAt, saved.message.$createdAt)
  }
})

test("new conversation and first message share owner-only ACLs and commit atomically", async () => {
  const { conversation, message } = await db.createConversation(
    "  Hello\n   world  ",
    "gpt-5-mini"
  )
  const writes = calls.filter(([method]) => method === "create")
  assert.equal(writes.length, 2)
  assert.equal(writes[0][1].data.title, "zenc:Hello world")
  assert.equal(writes[1][1].data.content, "zenc:Hello\n   world")
  for (const [, input] of writes) {
    assert.deepEqual(input.permissions, [
      'read("user:owner")',
      'update("user:owner")',
      'delete("user:owner")',
    ])
    assert.equal(input.data.userId, "owner")
    assert.equal(input.transactionId, "transaction")
  }
  assert.equal(message.status, "completed")
  assert.equal(conversation.lastMessageAt, message.$createdAt)
  assert.deepEqual(calls.at(-1), [
    "transaction",
    { transactionId: "transaction", commit: true },
  ])
})

test("failed prompt write rolls back and never commits an empty conversation", async () => {
  const original = client.tablesDB.createRow
  client.tablesDB.createRow = (input) => {
    if (input.tableId === "messages") throw new Error("write failed")
    return original(input)
  }
  await assert.rejects(
    db.createConversation("Hello", "gpt-5-mini"),
    /write failed/
  )
  assert.deepEqual(calls.at(-1), [
    "transaction",
    { transactionId: "transaction", rollback: true },
  ])
})

test("abort during a final response write rolls back before commit", async () => {
  const controller = new AbortController()
  const update = client.tablesDB.updateRow
  client.tablesDB.updateRow = async (input) => {
    const result = await update(input)
    controller.abort()
    return result
  }
  await assert.rejects(
    db.createMessage(
      "conversation",
      {
        modelId: "gpt-5-mini",
        role: "assistant",
        content: "Complete response",
      },
      controller.signal
    ),
    { name: "AbortError" }
  )
  assert.deepEqual(calls.at(-1), [
    "transaction",
    { transactionId: "transaction", rollback: true },
  ])
  assert.ok(
    !calls.some(([method, input]) => method === "transaction" && input.commit)
  )
})

test("defense-in-depth rejects shared foreign rows before reads or writes", async () => {
  client.tablesDB.getRow = async () => ({ ...owned, userId: "another-user" })
  for (const operation of [
    () => db.getConversation("conversation"),
    () => db.listMessages("conversation"),
    () => db.updateConversation("conversation", { title: "Changed" }),
    () => db.deleteConversation("conversation"),
    () =>
      db.createMessage("conversation", {
        modelId: "gpt-5-mini",
        role: "user",
        content: "Hello",
      }),
  ])
    await assert.rejects(operation(), { status: 404 })
  assert.equal(calls.length, 0)
})

test("history queries have explicit limits, owner filters and chronological ordering", async () => {
  await db.listConversations()
  await db.listMessages("conversation")
  for (const [, input] of calls.filter(([method]) => method === "list")) {
    const queries = input.queries.map(JSON.parse)
    assert.ok(
      queries.some(
        (query) => query.method === "limit" && query.values[0] === 100
      )
    )
    assert.ok(
      queries.some(
        (query) => query.attribute === "userId" && query.values[0] === "owner"
      )
    )
  }
  client.tablesDB.listRows = async () => ({
    rows: [{ $id: "new" }, { $id: "old" }],
  })
  assert.deepEqual(
    (await db.listMessages("conversation")).map((row) => row.$id),
    ["old", "new"]
  )
})

test("profile synchronization uses Auth identity, and preferences never accept another user ID", async () => {
  client.tablesDB.getRow = async (input) => {
    if (
      input.tableId === "users" &&
      calls.some(([method]) => method === "admin-create")
    )
      return { $id: "owner" }
    throw new AppwriteException("Missing", 404, "row_not_found")
  }
  await db.ensureUser()
  const profile = calls.find(([method]) => method === "admin-create")[1]
  assert.equal(profile.rowId, "owner")
  assert.deepEqual(profile.data, { displayName: "Owner", role: "user" })
  assert.deepEqual(profile.permissions, ['read("user:owner")'])
  await db.ensureUser()
  assert.equal(calls.filter(([method]) => method === "admin-create").length, 1)
  assert.equal(await db.getUserPreferences(), null)
  await db.updateUserPreferences({
    userId: "attacker",
    defaultModelId: "gpt-5-mini",
  })
  assert.equal(calls.at(-1)[1].rowId, "owner")
  assert.equal(calls.at(-1)[1].data.userId, "owner")
  await assert.rejects(db.updateUserPreferences({ defaultModelId: "unknown" }))
})

test("provisioning is repeatable, restrictive, non-destructive and seeded from the registry", async () => {
  const tables = new Map(),
    columns = new Map(),
    indexes = new Map(),
    rows = new Map()
  const conflict = () => {
    throw new AppwriteException("Exists", 409)
  }
  const fake = {
    get: async () => ({}),
    createTable: async (input) => {
      if (tables.has(input.tableId)) conflict()
      tables.set(input.tableId, {
        ...input,
        $permissions: input.permissions,
        enabled: true,
      })
    },
    getTable: async ({ tableId }) => tables.get(tableId),
    updateTable: async (input) =>
      tables.set(input.tableId, {
        ...tables.get(input.tableId),
        ...input,
        $permissions: input.permissions,
      }),
    getColumn: async ({ tableId, key }) => columns.get(`${tableId}.${key}`),
    updateVarcharColumn: async (input) => {
      const column = columns.get(`${input.tableId}.${input.key}`)
      columns.set(`${input.tableId}.${input.key}`, {
        ...column,
        ...input,
        default: input.xdefault,
        status: "available",
      })
    },
    createIndex: async (input) => {
      const key = `${input.tableId}.${input.key}`
      if (indexes.has(key)) conflict()
      indexes.set(key, { ...input, status: "available" })
    },
    getIndex: async ({ tableId, key }) => indexes.get(`${tableId}.${key}`),
    upsertRow: async (input) => rows.set(input.rowId, input),
    listRows: async () => ({ rows: [] }),
  }
  for (const type of [
    "varchar",
    "url",
    "enum",
    "text",
    "boolean",
    "datetime",
    "longtext",
    "integer",
  ]) {
    fake[`create${type[0].toUpperCase()}${type.slice(1)}Column`] = async (
      input
    ) => {
      const key = `${input.tableId}.${input.key}`
      if (columns.has(key)) conflict()
      columns.set(key, {
        ...input,
        type,
        default: input.xdefault,
        status: "available",
      })
    }
  }
  await provision(fake, "test-database")
  const counts = [tables.size, columns.size, indexes.size, rows.size]
  await provision(fake, "test-database")
  assert.deepEqual([tables.size, columns.size, indexes.size, rows.size], counts)
  columns.get("conversations.title").size = 120
  await provision(fake, "test-database")
  assert.equal(columns.get("conversations.title").size, 1024)
  assert.equal(columns.get("conversations.title").xdefault, null)
  assert.deepEqual(
    [...tables.keys()],
    [
      "usage_counters",
      "users",
      "conversations",
      "messages",
      "user_preferences",
      "user_crypto_keys",
      "attachments",
      "models",
    ]
  )
  assert.equal(
    schema.messages.columns.find((column) => column.key === "content").type,
    "longtext"
  )
  for (const [name, table] of tables) {
    assert.equal(table.rowSecurity, name !== "models")
    assert.deepEqual(
      table.$permissions,
      ["users", "attachments", "usage_counters", "user_crypto_keys"].includes(name)
        ? []
        : [name === "models" ? 'read("users")' : 'create("users")']
    )
  }
  assert.equal(rows.size, models.length)
  for (const model of models)
    assert.equal(rows.get(model.id).data.providerModelId, model.providerModelId)
  columns.get("messages.content").type = "boolean"
  await assert.rejects(
    provision(fake, "test-database"),
    /differs from the schema/
  )
})

function attachmentStore() {
  process.env.APPWRITE_STORAGE_BUCKET_ID = "private-files"
  const rows = new Map(),
    files = new Map()
  const notFound = () => {
    throw new AppwriteException("Missing", 404)
  }
  const get = async (input) => {
    if (input.tableId === "conversations") return { ...owned }
    if (input.tableId === "messages")
      return {
        $id: "prompt",
        conversationId: "conversation",
        userId: "owner",
        role: "user",
        status: "completed",
        content: "Hello",
      }
    return rows.get(input.rowId) ?? notFound()
  }
  client.tablesDB.getRow = get
  client.tablesDB.listRows = async (input) => ({
    rows: input.tableId === "attachments" ? [...rows.values()] : [],
  })
  client.storage = {
    getFile: async ({ fileId }) => files.get(fileId) ?? notFound(),
    getFileDownload: async ({ fileId }) =>
      (files.get(fileId) ?? notFound()).bytes,
  }
  const admin = {
    functions: {
      createExecution: async (input) => {
        calls.push(["execution-create", input])
        return { $id: "execution", status: "waiting" }
      },
    },
    tablesDB: {
      ...client.tablesDB,
      createRow: async (input) => {
        calls.push(["attachment-create", input])
        if (rows.has(input.rowId)) throw new AppwriteException("Conflict", 409)
        const row = {
          $id: input.rowId,
          $permissions: input.permissions,
          $updatedAt: new Date().toISOString(),
          ...input.data,
        }
        rows.set(input.rowId, row)
        return row
      },
      updateRow: async (input) => {
        calls.push(["attachment-update", input])
        if (input.tableId === "conversations") return owned
        const row = {
          ...(await get(input)),
          ...input.data,
          $updatedAt: new Date().toISOString(),
        }
        rows.set(input.rowId, row)
        return row
      },
      deleteRow: async (input) => {
        calls.push(["attachment-delete", input])
        rows.delete(input.rowId)
      },
    },
    storage: {
      createFile: async (input) => {
        calls.push(["file-create", input])
        if (files.has(input.fileId))
          throw new AppwriteException("Conflict", 409)
        files.set(input.fileId, {
          $permissions: input.permissions,
          sizeOriginal: 5,
          bytes: Buffer.from("Hello"),
          chunksUploaded: 1,
          chunksTotal: 1,
          $updatedAt: new Date().toISOString(),
        })
      },
      deleteFile: async (input) => {
        calls.push(["file-delete", input])
        if (!files.delete(input.fileId)) notFound()
      },
    },
  }
  const admission = admissionStore()
  for (const method of ["getRow", "createRow", "updateRow", "incrementRowColumn", "decrementRowColumn"]) {
    const original = admin.tablesDB[method]
    admin.tablesDB[method] = (p) => p.tableId === "usage_counters" ? admission.tablesDB[method](p) : original(p)
  }
  admin.tablesDB.createTransaction = admission.tablesDB.createTransaction
  admin.tablesDB.getTransaction = admission.tablesDB.getTransaction
  admin.tablesDB.updateTransaction = async (p) => {
    calls.push(["transaction", p])
    return admission.tablesDB.updateTransaction(p)
  }
  globalThis.__dbAdmin = () => admin
  return { rows, files, admin, admission }
}
const attachmentInput = {
  conversationId: "conversation",
  messageId: "prompt",
  slot: 0,
  fileName: "notes.txt",
  mimeType: "text/plain",
  kind: "document",
  bytes: Buffer.from("Hello"),
}

test("attachment upload reserves owner-only metadata, uses private storage and retries without duplicates", async () => {
  const { rows, files } = attachmentStore()
  const row = await db.createAttachment(attachmentInput)
  assert.deepEqual(row.$permissions, ['read("user:owner")'])
  assert.equal(row.userId, "owner")
  assert.equal(row.messageId, "prompt")
  assert.equal((await db.createAttachment(attachmentInput)).$id, row.$id)
  assert.equal(rows.size, 1)
  assert.equal(files.size, 1)
  assert.equal(calls.filter(([method]) => method === "file-create").length, 1)
  assert.deepEqual(files.get(row.$id).$permissions, row.$permissions)
  assert.ok(
    calls.findIndex(([method]) => method === "attachment-create") <
      calls.findIndex(([method]) => method === "file-create")
  )
  await assert.rejects(db.createAttachment({ ...attachmentInput, slot: 4 }), {
    code: "count",
  })
  await assert.rejects(
    db.createAttachment({ ...attachmentInput, bytes: Buffer.from("Other") }),
    { code: "slot_used" }
  )
  files.get(row.$id).bytes = Buffer.from("Other")
  await assert.rejects(db.createAttachment(attachmentInput), {
    code: "invalid_file",
  })
  await assert.rejects(db.downloadAttachment(row.$id), { status: 409 })
})

test("simultaneous same-slot uploads converge on one row and one private file", async () => {
  const { rows, files, admission } = attachmentStore()
  const results = await Promise.allSettled([
    db.createAttachment(attachmentInput),
    db.createAttachment(attachmentInput),
  ])
  assert.equal(results.filter(({ status }) => status === "fulfilled").length, 2)
  assert.equal(new Set(results.map((result) => result.value.$id)).size, 1)
  assert.equal(rows.size, 1)
  assert.equal(files.size, 1)
  assert.equal(calls.filter(([method]) => method === "file-create").length, 1)
  assert.ok(admission.counters().every(({ count }) => count === 5))
})

test("cross-user attachment reads, downloads, processing, removal and attachment linking are rejected", async () => {
  const { rows } = attachmentStore()
  const row = await db.createAttachment(attachmentInput)
  rows.set(row.$id, { ...row, userId: "other" })
  for (const operation of [
    () => db.getAttachment(row.$id),
    () => db.downloadAttachment(row.$id),
    () => db.queueAttachment(row.$id),
    () => db.deleteAttachment(row.$id),
  ])
    await assert.rejects(operation(), { status: 404 })
  const before = calls.length
  client.tablesDB.getRow = async () => ({ ...owned, userId: "other" })
  await assert.rejects(db.createAttachment(attachmentInput), { status: 404 })
  assert.equal(calls.length, before)
  client = null
  await assert.rejects(db.createAttachment(attachmentInput), { status: 401 })
})

test("enqueue sends only the attachment ID asynchronously and suppresses fresh/ready duplicates", async () => {
  const { rows } = attachmentStore()
  const row = await db.createAttachment(attachmentInput)
  assert.equal((await db.queueAttachment(row.$id)).status, "processing")
  await db.queueAttachment(row.$id)
  assert.deepEqual(calls.find(([name]) => name === "execution-create")[1], {
    functionId: "attachment-processor",
    body: JSON.stringify({ attachmentId: row.$id }),
    async: true,
  })
  rows.set(row.$id, {
    ...rows.get(row.$id),
    status: "ready",
    processedText: "cached",
  })
  await db.queueAttachment(row.$id)
  assert.equal(calls.filter(([name]) => name === "execution-create").length, 1)
  assert.ok(JSON.parse(rows.get(row.$id).metadata).hash)
  rows.set(row.$id, {
    ...rows.get(row.$id),
    status: "processing",
    $updatedAt: "2000-01-01T00:00:00Z",
  })
  await db.queueAttachment(row.$id)
  assert.equal(calls.filter(([name]) => name === "execution-create").length, 2)
})

test("simultaneous queue retries create only one Function execution", async () => {
  const { admin } = attachmentStore()
  const row = await db.createAttachment(attachmentInput)
  let executions = 0
  admin.functions.createExecution = async () => {
    executions++
    return { $id: "execution", status: "waiting" }
  }
  const results = await Promise.all([
    db.queueAttachment(row.$id),
    db.queueAttachment(row.$id),
  ])
  assert.equal(executions, 1)
  assert.ok(results.every((result) => result.status === "processing"))
})

test("deletion while queueing cannot resurrect attachment state", async () => {
  const { rows, files, admin } = attachmentStore()
  const row = await db.createAttachment(attachmentInput)
  let releaseExecution
  const executionStarted = Promise.withResolvers()
  admin.functions.createExecution = async () => {
    executionStarted.resolve()
    await new Promise((resolve) => {
      releaseExecution = resolve
    })
    return { $id: "execution", status: "waiting" }
  }
  const queueing = db.queueAttachment(row.$id)
  await executionStarted.promise
  await db.deleteAttachment(row.$id)
  releaseExecution()
  await queueing
  assert.equal(rows.size, 0)
  assert.equal(files.size, 0)
})

test("enqueue failure releases only its reservation and permits explicit retry", async () => {
  const { rows, admin, admission } = attachmentStore()
  const row = await db.createAttachment(attachmentInput)
  const create = admin.functions.createExecution
  admin.functions.createExecution = async () => {
    throw new AppwriteException("secret upstream response", 400)
  }
  await assert.rejects(db.queueAttachment(row.$id), {
    code: "enqueue_failed",
    status: 503,
  })
  assert.equal(rows.get(row.$id).status, "uploaded")
  assert.equal(JSON.parse(rows.get(row.$id).metadata).queued, undefined)
  assert.ok(JSON.parse(rows.get(row.$id).metadata).hash)
  assert.deepEqual(admission.counters().filter((r) => r.resource === "attachment_job").map((r) => r.count), [0, 0])
  admin.functions.createExecution = create
  assert.equal((await db.queueAttachment(row.$id)).status, "processing")
  assert.deepEqual(admission.counters().filter((r) => r.resource === "attachment_job").map((r) => r.count), [1, 1])
})

test("ambiguous execution failure keeps admission and suppresses immediate retry", async () => {
  const { rows, admin, admission } = attachmentStore()
  const row = await db.createAttachment(attachmentInput)
  let invoked = 0
  admin.functions.createExecution = async () => { invoked++; throw new TypeError("fetch failed") }
  await assert.rejects(db.queueAttachment(row.$id), { code: "enqueue_failed" })
  await db.queueAttachment(row.$id)
  assert.equal(invoked, 1)
  assert.equal(rows.get(row.$id).status, "processing")
  assert.deepEqual(admission.counters().filter((r) => r.resource === "attachment_job").map((r) => r.count), [1, 1])
})

test("attachment kill switch prevents Storage and execution calls", async () => {
  const { admin } = attachmentStore()
  const row = await db.createAttachment(attachmentInput)
  let invoked = 0
  admin.storage.createFile = admin.functions.createExecution = async () => { invoked++ }
  process.env.ZENOTE_ATTACHMENTS_ENABLED = "false"
  try {
    await assert.rejects(db.createAttachment({ ...attachmentInput, slot: 1 }), { code: "service_temporarily_unavailable" })
    await assert.rejects(db.queueAttachment(row.$id), { code: "service_temporarily_unavailable" })
    assert.equal(invoked, 0)
  } finally { delete process.env.ZENOTE_ATTACHMENTS_ENABLED }
})

test("Storage rejection compensates validated byte amount", async () => {
  const { admin, admission } = attachmentStore()
  admin.storage.createFile = async () => { throw new AppwriteException("Rejected", 413) }
  await assert.rejects(db.createAttachment(attachmentInput))
  assert.equal(admission.counters()[0].count, 0)
})

test("enqueue rejects partial or changed private blobs and deleting conversations", async () => {
  const { files } = attachmentStore()
  const row = await db.createAttachment(attachmentInput)
  files.get(row.$id).chunksUploaded = 0
  await assert.rejects(db.queueAttachment(row.$id), { status: 404 })
  files.get(row.$id).chunksUploaded = 1
  owned.isDeleting = true
  await assert.rejects(db.queueAttachment(row.$id), { status: 404 })
  assert.equal(calls.filter(([name]) => name === "execution-create").length, 0)
})

test("metadata failure uploads nothing; failed upload retains a cleanup reference and retry recovers", async () => {
  const { rows, files, admin } = attachmentStore()
  const createTransaction = admin.tablesDB.createTransaction
  admin.tablesDB.createTransaction = async () => {
    throw new Error("transaction unavailable")
  }
  await assert.rejects(
    db.createAttachment(attachmentInput),
    /transaction unavailable/
  )
  assert.equal(files.size, 0)
  admin.tablesDB.createTransaction = createTransaction
  const upload = admin.storage.createFile
  admin.storage.createFile = async (input) => {
    await upload(input)
    throw new Error("upload failed")
  }
  await assert.rejects(db.createAttachment(attachmentInput), /upload failed/)
  assert.equal(rows.size, 1)
  assert.equal(files.size, 0)
  admin.storage.createFile = upload
  await db.createAttachment(attachmentInput)
  assert.equal(rows.size, 1)
  assert.equal(files.size, 1)
})

test("attachment removal deletes the blob first, preserving metadata when cleanup must retry", async () => {
  const { rows, files, admin } = attachmentStore()
  const row = await db.createAttachment(attachmentInput)
  const remove = admin.storage.deleteFile
  admin.storage.deleteFile = async () => {
    throw new Error("storage unavailable")
  }
  await assert.rejects(db.deleteAttachment(row.$id), /storage unavailable/)
  assert.equal(rows.size, 1)
  admin.storage.deleteFile = remove
  await db.deleteAttachment(row.$id)
  assert.equal(files.size, 0)
  assert.equal(rows.size, 0)
  const methods = calls.map(([method]) => method)
  assert.ok(
    methods.indexOf("file-delete") < methods.indexOf("attachment-delete")
  )
})

test("conversation deletion tombstones first and cleans attachment rows and files before its parent", async () => {
  const { rows, files } = attachmentStore()
  await db.createAttachment(attachmentInput)
  calls.length = 0
  await db.deleteConversation("conversation")
  assert.deepEqual(calls[0][1].data, { isDeleting: true })
  assert.equal(rows.size, 0)
  assert.equal(files.size, 0)
  assert.equal(calls.at(-1)[1].tableId, "conversations")
})

test("storage provisioning is idempotent and denies bucket-wide access", async () => {
  let bucket
  const storage = {
    createBucket: async (input) => {
      if (bucket) throw new AppwriteException("Exists", 409)
      bucket = { ...input, $permissions: input.permissions }
    },
    getBucket: async () => bucket,
    updateBucket: async (input) => {
      bucket = { ...bucket, ...input, $permissions: input.permissions }
    },
  }
  await provisionStorage(storage, "private-files")
  const snapshot = structuredClone(bucket)
  await provisionStorage(storage, "private-files")
  assert.deepEqual(bucket, snapshot)
  assert.deepEqual(bucket.$permissions, [])
  assert.equal(bucket.fileSecurity, true)
  assert.equal(bucket.maximumFileSize, 5_000_000)
  assert.equal(bucket.encryption, true)
  assert.equal(bucket.antivirus, true)
  assert.ok(!bucket.allowedFileExtensions.includes("svg"))
})

test("Function provisioning uses checked-in settings idempotently without variables or deployments", async () => {
  let settings
  const functions = {
    create: async (input) => {
      if (settings) throw new AppwriteException("Exists", 409)
      settings = input
    },
    update: async (input) => {
      settings = input
    },
  }
  await provisionAttachmentFunction(functions)
  const snapshot = structuredClone(settings)
  await provisionAttachmentFunction(functions)
  assert.deepEqual(settings, snapshot)
  assert.equal(settings.functionId, "attachment-processor")
  assert.equal(settings.runtime, "node-22")
  assert.equal(settings.entrypoint, "dist/main.js")
  assert.equal(
    settings.commands,
    "npm ci --include=dev && npm run build && npm prune --omit=dev"
  )
  assert.equal(settings.timeout, 300)
  assert.deepEqual(settings.execute, [])
  assert.deepEqual(settings.scopes, ["rows.read", "rows.write", "files.read"])
  assert.equal(settings.runtimeSpecification, "s-0.5vcpu-512mb")
  assert.equal(settings.buildSpecification, "s-2vcpu-2gb")
})

test("setup validation errors identify the parameter without exposing response details", () => {
  const message = setupFailureMessage(
    new AppwriteException(
      "Invalid `buildSpecification` param: private-response-details",
      400,
      "general_argument_invalid"
    )
  )
  assert.match(message, /Rejected parameter: buildSpecification/)
  assert.doesNotMatch(message, /private-response-details/)
  assert.doesNotMatch(
    setupFailureMessage(
      new AppwriteException(
        "private-response-details",
        401,
        "general_unauthorized_scope"
      )
    ),
    /private-response-details/
  )
})
