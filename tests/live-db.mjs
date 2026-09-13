// Opt-in: uses real Appwrite, disposable users, and no AI provider calls.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { randomUUID } from "node:crypto"
import { Account, AppwriteException, Client, ID, Query, TablesDB, Users } from "node-appwrite"
import ts from "typescript"

for (const name of ["NEXT_PUBLIC_APPWRITE_ENDPOINT", "NEXT_PUBLIC_APPWRITE_PROJECT_ID", "APPWRITE_DATABASE_ID"]) {
  if (!process.env[name]) throw new Error(`Missing ${name}`)
}
const provisioningApiKey = process.env.APPWRITE_PROVISIONING_API_KEY || process.env.APPWRITE_API_KEY
if (!provisioningApiKey) {
  throw new Error("Missing APPWRITE_PROVISIONING_API_KEY or APPWRITE_API_KEY")
}
const databaseId = process.env.APPWRITE_DATABASE_ID
const baseClient = () => new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID)
const adminClient = baseClient().setKey(provisioningApiKey)
const admin = { account: new Account(adminClient), tablesDB: new TablesDB(adminClient) }
const users = new Users(adminClient)
let session
globalThis.__liveDbSession = () => session
globalThis.__liveDbAdmin = () => admin
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }
    if (specifier === "@/lib/appwrite-server") return {
      url: "data:text/javascript,export const createSessionClient=async()=>globalThis.__liveDbSession(); export const createAdminServerClient=()=>globalThis.__liveDbAdmin()",
      shortCircuit: true,
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
const { models } = await import("../lib/models.ts")
const createdUsers = []
const createdRows = []
const ownRow = (tableId, rowId) => createdRows.push({ databaseId, tableId, rowId })
const trackMessage = (saved) => {
  ownRow("conversations", saved.conversation.$id)
  ownRow("messages", saved.message.$id)
  return saved
}
const denied = (error) => error instanceof AppwriteException && [401, 403, 404].includes(error.code)
let step = "create disposable users"

async function login(user) {
  const auth = await admin.account.createEmailPasswordSession({ email: user.email, password: user.password })
  assert.ok(auth.secret, "SSR login must return a session secret")
  const client = baseClient().setSession(auth.secret)
  return { account: new Account(client), tablesDB: new TablesDB(client) }
}

try {
  for (let i = 0; i < 2; i++) {
    const user = { userId: ID.unique(), email: `zenote-phase2-${randomUUID()}@example.invalid`, password: `${randomUUID()}aA!9`, name: "Phase 2 smoke test" }
    await users.create(user)
    createdUsers.push(user)
    ownRow("users", user.userId)
    ownRow("user_preferences", user.userId)
  }
  const owner = await login(createdUsers[0])
  const other = await login(createdUsers[1])
  session = owner

  step = "fresh profile and empty history"
  assert.deepEqual(await db.listConversations(), [])
  await db.ensureUser()
  await db.ensureUser()
  assert.equal((await owner.tablesDB.getRow({ databaseId, tableId: "users", rowId: createdUsers[0].userId })).role, "user")
  await assert.rejects(owner.tablesDB.updateRow({ databaseId, tableId: "users", rowId: createdUsers[0].userId, data: { role: "admin" } }), denied)
  console.info("PASS: fresh user has no fake chats; profile bootstrap is idempotent and owner read-only")

  step = "first prompt and completed response"
  const first = trackMessage(await db.createConversation("  First\n  prompt  ", models[0].id))
  assert.equal(first.conversation.title, "First prompt")
  assert.equal(first.message.content, "First\n  prompt")
  const conversationId = first.conversation.$id
  assert.equal((await db.listMessages(conversationId)).length, 1)
  trackMessage(await db.createMessage(conversationId, {
    modelId: models[0].id, role: "assistant", content: "Completed answer", parentMessageId: first.message.$id,
  }))
  await assert.rejects(db.createMessage(conversationId, {
    modelId: models[0].id, role: "assistant", content: "Duplicate answer", parentMessageId: first.message.$id,
  }), (error) => error instanceof AppwriteException && error.code === 409)
  assert.deepEqual((await db.listMessages(conversationId)).map((row) => row.role), ["user", "assistant"])
  console.info("PASS: session transactions persist first prompt and one completed response")

  step = "follow-up, abort, preferences, and reopening"
  const followup = trackMessage(await db.createMessage(conversationId, { role: "user", content: "Follow-up", modelId: models[1].id }))
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(db.createMessage(conversationId, {
    role: "assistant", content: "Aborted", modelId: models[1].id, parentMessageId: followup.message.$id,
  }, abort.signal), { name: "AbortError" })
  assert.equal((await db.listMessages(conversationId)).length, 3)
  trackMessage(await db.createMessage(conversationId, {
    role: "assistant", content: "Follow-up answer", modelId: models[1].id, parentMessageId: followup.message.$id,
  }))
  await db.updateUserPreferences({ defaultModelId: models[1].id })
  await owner.account.deleteSession({ sessionId: "current" })
  session = await login(createdUsers[0])
  assert.equal((await db.getUserPreferences()).defaultModelId, models[1].id)
  assert.equal((await db.getConversation(conversationId)).modelId, models[1].id)
  assert.equal((await db.listMessages(conversationId)).length, 4)
  assert.equal((await db.listConversations())[0].$id, conversationId)
  console.info("PASS: follow-ups, abort, model preference, reopening and logout/login retain valid history")

  step = "cross-user isolation and read-only catalog"
  session = other
  step = "user B conversation listing"
  assert.deepEqual(await db.listConversations(), [])
  step = "user B conversation lookup"
  await assert.rejects(db.getConversation(conversationId), { status: 404 })
  step = "user B message listing"
  await assert.rejects(db.listMessages(conversationId), { status: 404 })
  step = "user B conversation deletion"
  await assert.rejects(db.deleteConversation(conversationId), { status: 404 })
  for (const [tableId, rowId] of [["conversations", conversationId], ["messages", first.message.$id], ["users", createdUsers[0].userId], ["user_preferences", createdUsers[0].userId]]) {
    step = `user B direct ${tableId} lookup`
    await assert.rejects(other.tablesDB.getRow({ databaseId, tableId, rowId }), denied)
  }
  step = "authenticated catalog read"
  const catalog = await other.tablesDB.listRows({ databaseId, tableId: "models", queries: [Query.limit(100)] })
  assert.ok(catalog.rows.some((row) => row.slug === models[0].id))
  step = "unauthorized catalog write"
  const testModelId = ID.unique()
  await admin.tablesDB.createRow({
    databaseId, tableId: "models", rowId: testModelId, permissions: [],
    data: {
      slug: testModelId, name: "Disposable model", provider: models[0].provider,
      providerModelId: models[0].providerModelId, supportsVision: false,
      supportsFiles: false, supportsTools: false, supportsReasoning: false, isActive: false, sortOrder: 999,
    },
  })
  ownRow("models", testModelId)
  // A same-value update can be a read-only no-op. Test a real mutation on our own fixture.
  await assert.rejects(other.tablesDB.updateRow({ databaseId, tableId: "models", rowId: testModelId, data: { isActive: true } }), denied)
  console.info("PASS: user B cannot read/delete user A's data via app or direct SDK; catalog is read-only")

  step = "sidebar mutations and deletion"
  session = await login(createdUsers[0])
  await db.updateConversation(conversationId, { title: "Renamed" })
  assert.equal((await db.listConversations())[0].title, "Renamed")
  await db.updateConversation(conversationId, { isArchived: true })
  assert.deepEqual(await db.listConversations(), [])
  await db.deleteConversation(conversationId)
  await assert.rejects(db.getConversation(conversationId), { status: 404 })
  const remaining = await session.tablesDB.listRows({ databaseId, tableId: "messages", queries: [Query.equal("conversationId", conversationId), Query.limit(1)] })
  assert.equal(remaining.rows.length, 0)
  console.info("PASS: rename/archive/delete persist and remove the conversation's messages")
} catch (error) {
  // Do not print SDK request/response bodies or credentials.
  console.error(`FAIL at ${step}: ${error instanceof AppwriteException ? `${error.code} ${error.type}` : error.name}`)
  process.exitCode = 1
} finally {
  let cleanupFailed = false
  for (const row of createdRows.reverse()) {
    try { await admin.tablesDB.deleteRow(row) }
    catch (error) {
      if (error.code !== 404) { console.error(`Cleanup failed: ${row.tableId}/${row.rowId} (${error.code})`); process.exitCode = 1; cleanupFailed = true }
    }
  }
  for (const user of createdUsers) {
    try { await users.delete({ userId: user.userId }) }
    catch (error) { console.error(`Cleanup failed: Auth user ${user.userId} (${error.code})`); process.exitCode = 1; cleanupFailed = true }
  }
  if (!cleanupFailed) console.info("PASS: disposable rows and Auth users cleaned up")
}
