import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import { registerHooks } from "node:module"
import { test, beforeEach } from "node:test"
import { AppwriteException, Client, TablesDB } from "node-appwrite"
import ts from "typescript"

let client
globalThis.__dbSession = () => client
globalThis.__dbAdmin = () => ({ tablesDB: {
  createRow: async (input) => {
    calls.push(["admin-create", input])
    return { $id: input.rowId, ...input.data }
  },
} })
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }
    if (specifier === "@/lib/appwrite-server") return {
      url: "data:text/javascript,export const createSessionClient=async()=>globalThis.__dbSession(); export const createAdminServerClient=()=>globalThis.__dbAdmin()", shortCircuit: true,
    }
    if (specifier.startsWith("@/")) return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith(".ts")) return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText,
    }
    return next(url, context)
  },
})
const db = await import("../lib/db.ts")
const { savePromptAction } = await import("../app/(app)/chat/actions.ts")
const { schema, provision } = await import("../scripts/setup-appwrite.mjs")
const { models } = await import("../lib/models.ts")
let calls
const owned = { $id: "conversation", userId: "owner", modelId: "gpt-5-mini" }
beforeEach(() => {
  calls = []
  process.env.APPWRITE_DATABASE_ID = "test-database"
  client = {
    account: { get: async () => ({ $id: "owner", name: "Owner" }) },
    tablesDB: {
      getRow: async (input) => { calls.push(["get", input]); return { ...owned } },
      listRows: async (input) => { calls.push(["list", input]); return { rows: [] } },
      createTransaction: async () => ({ $id: "transaction" }),
      updateTransaction: async (input) => { calls.push(["transaction", input]) },
      createRow: async (input) => { calls.push(["create", input]); return { $id: input.rowId, $createdAt: "2026-09-10T10:00:00.000Z", ...input.data } },
      updateRow: async (input) => { calls.push(["update", input]); return { ...owned, ...input.data } },
      upsertRow: async (input) => { calls.push(["upsert", input]); return input },
      deleteRow: async (input) => { calls.push(["delete", input]) },
    },
  }
})

test("all normal database operations require an authenticated session", async () => {
  client = null
  await assert.rejects(db.listConversations(), { status: 401 })
  await assert.rejects(db.createConversation("Hello", "gpt-5-mini"), { status: 401 })
})

test("conversation rows from the real SDK are plain objects at the React boundary", async (t) => {
  const row = { ...owned, title: "Hello", lastMessageAt: null, $updatedAt: "2026-09-10T10:00:00.000Z", $permissions: ['read("user:owner")'] }
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ total: 1, rows: [row] }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  client.tablesDB = new TablesDB(new Client().setEndpoint(`http://127.0.0.1:${server.address().port}/v1`).setProject("test-project").setSession("test-session"))
  const raw = await client.tablesDB.listRows({ databaseId: "test-database", tableId: "conversations" })
  assert.equal(Object.getPrototypeOf(raw.rows[0]), null)
  const conversations = await db.listConversations()
  assert.equal(Object.getPrototypeOf(conversations[0]), Object.prototype)
  assert.deepEqual(conversations, [row])
})

test("first-send and follow-up actions return plain conversation and message objects", async () => {
  for (const method of ["createRow", "updateRow"]) {
    const original = client.tablesDB[method]
    client.tablesDB[method] = async (input) => Object.assign(Object.create(null), await original(input))
  }
  for (const conversationId of [undefined, "conversation"]) {
    const saved = await savePromptAction({ conversationId, modelId: "gpt-5-mini", content: "Hello" })
    assert.equal(saved.error, undefined)
    assert.equal(Object.getPrototypeOf(saved.conversation), Object.prototype)
    assert.equal(Object.getPrototypeOf(saved.message), Object.prototype)
    assert.equal(saved.message.content, "Hello")
    assert.equal(saved.message.status, "completed")
    assert.equal(saved.conversation.lastMessageAt, saved.message.$createdAt)
  }
})

test("new conversation and first message share owner-only ACLs and commit atomically", async () => {
  const { conversation, message } = await db.createConversation("  Hello\n   world  ", "gpt-5-mini")
  const writes = calls.filter(([method]) => method === "create")
  assert.equal(writes.length, 2)
  assert.equal(writes[0][1].data.title, "Hello world")
  for (const [, input] of writes) {
    assert.deepEqual(input.permissions, ['read("user:owner")', 'update("user:owner")', 'delete("user:owner")'])
    assert.equal(input.data.userId, "owner")
    assert.equal(input.transactionId, "transaction")
  }
  assert.equal(message.status, "completed")
  assert.equal(conversation.lastMessageAt, message.$createdAt)
  assert.deepEqual(calls.at(-1), ["transaction", { transactionId: "transaction", commit: true }])
})

test("failed prompt write rolls back and never commits an empty conversation", async () => {
  const original = client.tablesDB.createRow
  client.tablesDB.createRow = (input) => {
    if (input.tableId === "messages") throw new Error("write failed")
    return original(input)
  }
  await assert.rejects(db.createConversation("Hello", "gpt-5-mini"), /write failed/)
  assert.deepEqual(calls.at(-1), ["transaction", { transactionId: "transaction", rollback: true }])
})

test("abort during a final response write rolls back before commit", async () => {
  const controller = new AbortController()
  const update = client.tablesDB.updateRow
  client.tablesDB.updateRow = async (input) => {
    const result = await update(input)
    controller.abort()
    return result
  }
  await assert.rejects(db.createMessage("conversation", {
    modelId: "gpt-5-mini", role: "assistant", content: "Complete response",
  }, controller.signal), { name: "AbortError" })
  assert.deepEqual(calls.at(-1), ["transaction", { transactionId: "transaction", rollback: true }])
  assert.ok(!calls.some(([method, input]) => method === "transaction" && input.commit))
})

test("defense-in-depth rejects shared foreign rows before reads or writes", async () => {
  client.tablesDB.getRow = async () => ({ ...owned, userId: "another-user" })
  for (const operation of [
    () => db.getConversation("conversation"), () => db.listMessages("conversation"),
    () => db.updateConversation("conversation", { title: "Changed" }),
    () => db.deleteConversation("conversation"),
    () => db.createMessage("conversation", { modelId: "gpt-5-mini", role: "user", content: "Hello" }),
  ]) await assert.rejects(operation(), { status: 404 })
  assert.equal(calls.length, 0)
})

test("history queries have explicit limits, owner filters and chronological ordering", async () => {
  await db.listConversations()
  await db.listMessages("conversation")
  for (const [, input] of calls.filter(([method]) => method === "list")) {
    const queries = input.queries.map(JSON.parse)
    assert.ok(queries.some((query) => query.method === "limit" && query.values[0] === 100))
    assert.ok(queries.some((query) => query.attribute === "userId" && query.values[0] === "owner"))
  }
  client.tablesDB.listRows = async () => ({ rows: [{ $id: "new" }, { $id: "old" }] })
  assert.deepEqual((await db.listMessages("conversation")).map((row) => row.$id), ["old", "new"])
})

test("profile synchronization uses Auth identity, and preferences never accept another user ID", async () => {
  client.tablesDB.getRow = async (input) => {
    if (input.tableId === "users" && calls.some(([method]) => method === "admin-create")) return { $id: "owner" }
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
  await db.updateUserPreferences({ userId: "attacker", defaultModelId: "gpt-5-mini" })
  assert.equal(calls.at(-1)[1].rowId, "owner")
  assert.equal(calls.at(-1)[1].data.userId, "owner")
  await assert.rejects(db.updateUserPreferences({ defaultModelId: "unknown" }))
})

test("provisioning is repeatable, restrictive, non-destructive and seeded from the registry", async () => {
  const tables = new Map(), columns = new Map(), indexes = new Map(), rows = new Map()
  const conflict = () => { throw new AppwriteException("Exists", 409) }
  const fake = {
    get: async () => ({}),
    createTable: async (input) => { if (tables.has(input.tableId)) conflict(); tables.set(input.tableId, { ...input, $permissions: input.permissions, enabled: true }) },
    getTable: async ({ tableId }) => tables.get(tableId),
    updateTable: async (input) => tables.set(input.tableId, { ...tables.get(input.tableId), ...input, $permissions: input.permissions }),
    getColumn: async ({ tableId, key }) => columns.get(`${tableId}.${key}`),
    createIndex: async (input) => { const key = `${input.tableId}.${input.key}`; if (indexes.has(key)) conflict(); indexes.set(key, { ...input, status: "available" }) },
    getIndex: async ({ tableId, key }) => indexes.get(`${tableId}.${key}`),
    upsertRow: async (input) => rows.set(input.rowId, input),
    listRows: async () => ({ rows: [] }),
  }
  for (const type of ["varchar", "url", "enum", "text", "boolean", "datetime", "longtext", "integer"]) {
    fake[`create${type[0].toUpperCase()}${type.slice(1)}Column`] = async (input) => {
      const key = `${input.tableId}.${input.key}`
      if (columns.has(key)) conflict()
      columns.set(key, { ...input, type, default: input.xdefault, status: "available" })
    }
  }
  await provision(fake, "test-database")
  const counts = [tables.size, columns.size, indexes.size, rows.size]
  await provision(fake, "test-database")
  assert.deepEqual([tables.size, columns.size, indexes.size, rows.size], counts)
  assert.deepEqual([...tables.keys()], ["users", "conversations", "messages", "user_preferences", "models"])
  assert.equal(schema.messages.columns.find((column) => column.key === "content").type, "longtext")
  for (const [name, table] of tables) {
    assert.equal(table.rowSecurity, name !== "models")
    assert.deepEqual(table.$permissions, name === "users" ? [] : [name === "models" ? 'read("users")' : 'create("users")'])
  }
  assert.equal(rows.size, models.length)
  for (const model of models) assert.equal(rows.get(model.id).data.providerModelId, model.providerModelId)
  columns.get("messages.content").type = "boolean"
  await assert.rejects(provision(fake, "test-database"), /differs from the schema/)
})
