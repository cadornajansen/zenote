import { pathToFileURL } from "node:url"
import { setTimeout } from "node:timers/promises"
import { Client, Permission, Query, Role, TablesDB } from "node-appwrite"
import { models } from "../lib/models.ts"

const varchar = (key, size, required = true) => ({ key, type: "varchar", size, required })
const column = (key, type, required = true, extra = {}) => ({ key, type, required, ...extra })
const index = (key, columns, type = "key", orders) => ({ key, columns, type, ...(orders && { orders }) })

export const schema = {
  users: {
    columns: [
      varchar("displayName", 128),
      column("avatarUrl", "url", false),
      column("role", "enum", false, { elements: ["user", "admin"], xdefault: "user" }),
    ],
    indexes: [],
  },
  conversations: {
    columns: [
      varchar("userId", 36), varchar("title", 120), varchar("modelId", 64),
      column("systemPrompt", "text", false),
      column("isPinned", "boolean", false, { xdefault: false }),
      column("isArchived", "boolean", false, { xdefault: false }),
      column("lastMessageAt", "datetime", false),
    ],
    indexes: [
      index("userId", ["userId"]),
      index("userId_lastMessageAt", ["userId", "lastMessageAt"], "key", ["ASC", "DESC"]),
      index("userId_isArchived", ["userId", "isArchived"]),
    ],
  },
  messages: {
    columns: [
      varchar("conversationId", 36), varchar("userId", 36),
      column("role", "enum", true, { elements: ["user", "assistant", "system", "tool"] }),
      column("content", "longtext"),
      column("status", "enum", true, { elements: ["pending", "streaming", "completed", "failed"] }),
      varchar("parentMessageId", 36, false),
    ],
    indexes: [
      index("conversationId", ["conversationId"]),
      index("conversationId_createdAt", ["conversationId", "$createdAt"], "key", ["ASC", "DESC"]),
      index("userId", ["userId"]),
    ],
  },
  user_preferences: {
    columns: [varchar("userId", 36), varchar("defaultModelId", 64, false), column("customInstructions", "text", false)],
    indexes: [index("userId", ["userId"], "unique")],
  },
  models: {
    columns: [
      varchar("slug", 64), varchar("name", 128), varchar("provider", 64), varchar("providerModelId", 128),
      column("description", "text", false),
      ...["supportsVision", "supportsFiles", "supportsTools", "supportsReasoning", "isActive"].map((key) => column(key, "boolean")),
      column("contextWindow", "integer", false, { min: 1 }),
      column("sortOrder", "integer", true, { min: 0 }),
    ],
    indexes: [index("slug", ["slug"], "unique")],
  },
}

// Only skip explicit conflicts. Permission, quota, and schema errors must stop setup.
async function createMissing(create) {
  try { await create() } catch (error) { if (error.code !== 409) throw error }
}

async function available(get, label) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const resource = await get()
    if (resource.status === "available") return resource
    if (["failed", "stuck"].includes(resource.status)) throw new Error(`${label} failed; inspect it in Appwrite before rerunning setup.`)
    await setTimeout(500)
  }
  throw new Error(`${label} is not ready. Rerun setup after Appwrite finishes provisioning.`)
}

export async function provision(tablesDB, databaseId, seed = true) {
  // Never silently create a different database if configuration is wrong.
  await tablesDB.get({ databaseId })
  for (const [tableId, definition] of Object.entries(schema)) {
    const base = { databaseId, tableId }
    const permissions = tableId === "models"
      ? [Permission.read(Role.users())]
      : tableId === "users" ? [] : [Permission.create(Role.users())]
    const rowSecurity = tableId !== "models"
    await createMissing(() => tablesDB.createTable({ ...base, name: tableId, permissions, rowSecurity }))
    const table = await tablesDB.getTable(base)
    if (!table.enabled) throw new Error(`${tableId} is disabled; enable it explicitly before setup.`)
    if (table.rowSecurity !== rowSecurity || JSON.stringify([...table.$permissions].sort()) !== JSON.stringify([...permissions].sort())) {
      await tablesDB.updateTable({ ...base, permissions, rowSecurity })
    }
    for (const spec of definition.columns) {
      const method = `create${spec.type[0].toUpperCase()}${spec.type.slice(1)}Column`
      const { type, ...options } = spec
      await createMissing(() => tablesDB[method]({ ...base, ...options }))
      const actual = await available(() => tablesDB.getColumn({ ...base, key: spec.key }), `${tableId}.${spec.key}`)
      // Appwrite reports string-family columns as type=string plus format/size.
      const actualType = actual.format || actual.type
      const expectedType = type === "varchar" ? "string" : type
      const compatibleType = actualType === type || actualType === expectedType ||
        (actualType === "string" && ["text", "longtext"].includes(type) && actual.size >= (type === "longtext" ? 4_294_967_295 : 65_535))
      if (!compatibleType || actual.required !== spec.required ||
        (spec.size !== undefined && actual.size !== spec.size) ||
        (spec.xdefault !== undefined && actual.default !== spec.xdefault) ||
        (spec.elements && JSON.stringify(actual.elements) !== JSON.stringify(spec.elements))) {
        throw new Error(`Existing column ${tableId}.${spec.key} differs from the schema. No data was deleted; reconcile it manually.`)
      }
    }
    for (const spec of definition.indexes) {
      await createMissing(() => tablesDB.createIndex({ ...base, ...spec }))
      const actual = await available(() => tablesDB.getIndex({ ...base, key: spec.key }), `${tableId}.${spec.key}`)
      if (actual.type !== spec.type || JSON.stringify(actual.columns) !== JSON.stringify(spec.columns) ||
        (spec.orders && JSON.stringify(actual.orders) !== JSON.stringify(spec.orders))) {
        throw new Error(`Existing index ${tableId}.${spec.key} differs from the schema. Reconcile it manually.`)
      }
    }
    console.info(`Ready: ${tableId}`)
  }
  // Reconcile profile ACLs from earlier setups without changing profile data.
  // Profile writes are trusted-server only because Appwrite has no column-level ACLs.
  let cursor
  for (;;) {
    const { rows } = await tablesDB.listRows({
      databaseId, tableId: "users", total: false,
      queries: [Query.orderAsc("$id"), Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])],
    })
    for (const row of rows) {
      const permissions = [Permission.read(Role.user(row.$id))]
      if (JSON.stringify(row.$permissions) !== JSON.stringify(permissions)) {
        await tablesDB.updateRow({ databaseId, tableId: "users", rowId: row.$id, permissions })
      }
    }
    if (rows.length < 100) break
    cursor = rows.at(-1).$id
  }
  if (seed) {
    for (const [sortOrder, model] of models.entries()) {
      await tablesDB.upsertRow({
        databaseId, tableId: "models", rowId: model.id, permissions: [],
        data: {
          slug: model.id, name: model.name, provider: model.provider,
          providerModelId: model.providerModelId, description: model.description,
          supportsVision: model.capabilities.image, supportsFiles: model.capabilities.files,
          supportsTools: model.capabilities.tools, supportsReasoning: model.capabilities.reasoning,
          contextWindow: null, isActive: true, sortOrder,
        },
      })
    }
    console.info(`Seeded ${models.length} models from lib/models.ts`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    for (const key of ["NEXT_PUBLIC_APPWRITE_ENDPOINT", "NEXT_PUBLIC_APPWRITE_PROJECT_ID", "APPWRITE_API_KEY", "APPWRITE_DATABASE_ID"]) {
      if (!process.env[key]) throw new Error(`Missing ${key}`)
    }
    const client = new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT)
      .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY)
    await provision(new TablesDB(client), process.env.APPWRITE_DATABASE_ID, !process.argv.includes("--no-seed"))
  } catch (error) {
    // SDK exceptions can contain request details. Never dump credentials or response bodies.
    console.error(error.code ? `Appwrite setup failed (${error.code}, ${error.type}). Check configuration and key scopes.` : error.message)
    process.exitCode = 1
  }
}
