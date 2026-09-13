import { pathToFileURL } from "node:url"
import { readFileSync } from "node:fs"
import { setTimeout } from "node:timers/promises"
import {
  Client,
  Functions,
  Permission,
  Query,
  Role,
  Storage,
  TablesDB,
} from "node-appwrite"
import { models } from "../lib/models.ts"
import {
  ATTACHMENT_LIMITS,
  ATTACHMENT_TYPES,
} from "../lib/attachment-policy.ts"

const varchar = (key, size, required = true) => ({
  key,
  type: "varchar",
  size,
  required,
})
const column = (key, type, required = true, extra = {}) => ({
  key,
  type,
  required,
  ...extra,
})
const index = (key, columns, type = "key", orders) => ({
  key,
  columns,
  type,
  ...(orders && { orders }),
})

export const schema = {
  usage_counters: {
    columns: [
      column("scope", "enum", true, { elements: ["user", "global"] }),
      varchar("subjectId", 36),
      column("resource", "enum", true, { elements: ["chat_request", "attachment_job", "attachment_bytes"] }),
      column("window", "enum", true, { elements: ["minute", "day", "lease"] }),
      column("windowStart", "datetime"),
      column("count", "integer", true, { min: 0, max: Number.MAX_SAFE_INTEGER }),
      column("leases", "text", false),
    ],
    indexes: [index("windowStart", ["windowStart"])],
  },
  credit_accounts: {
    columns: [
      varchar("userId", 36),
      column("freeCredits", "integer", true, { min: 0, max: Number.MAX_SAFE_INTEGER }),
      column("purchasedCredits", "integer", true, { min: 0, max: Number.MAX_SAFE_INTEGER }),
      varchar("freeGrantPeriod", 7),
    ],
    indexes: [index("userId", ["userId"], "unique")],
  },
  credit_transactions: {
    columns: [
      varchar("userId", 36),
      column("type", "enum", true, { elements: ["free_monthly_grant", "purchase", "chat_usage", "adjustment", "refund"] }),
      column("amount", "integer", true, { min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
      column("bucket", "enum", true, { elements: ["free", "purchased"] }),
      column("balanceAfter", "integer", true, { min: 0, max: Number.MAX_SAFE_INTEGER }),
      varchar("referenceType", 32),
      varchar("referenceId", 64),
      varchar("idempotencyKey", 128),
      column("metadataJson", "text", false),
    ],
    indexes: [index("userId_createdAt", ["userId", "$createdAt"], "key", ["ASC", "DESC"]), index("idempotencyKey", ["idempotencyKey"], "unique"), index("referenceId", ["referenceId"])],
  },
  credit_reservations: {
    columns: [
      varchar("userId", 36),
      varchar("requestedModel", 64),
      column("reservedCredits", "integer", true, { min: 1, max: 100 }),
      column("reservedFreeCredits", "integer", true, { min: 0, max: 100 }),
      column("reservedPurchasedCredits", "integer", true, { min: 0, max: 100 }),
      varchar("freeGrantPeriod", 7),
      column("status", "enum", true, { elements: ["reserved", "settled", "released"] }),
      column("expiresAt", "datetime"),
    ],
    indexes: [
      index("userId_status", ["userId", "status"]),
      index("userId_status_expiresAt", ["userId", "status", "expiresAt"]),
      index("expiresAt", ["expiresAt"]),
    ],
  },
  usage_events: {
    columns: [
      varchar("userId", 36), varchar("conversationId", 36, false), varchar("messageId", 36, false),
      column("operation", "enum", true, { elements: ["chat", "attachment_image", "attachment_pdf", "attachment_audio", "attachment_document"] }),
      varchar("requestedModel", 64, false), varchar("actualModel", 64, false), varchar("provider", 64),
      column("fallbackUsed", "boolean"), column("inputTokens", "integer", false, { min: 0 }), column("outputTokens", "integer", false, { min: 0 }), column("cachedInputTokens", "integer", false, { min: 0 }), column("totalTokens", "integer", false, { min: 0 }),
      column("latencyMs", "integer", true, { min: 0 }), column("status", "enum", true, { elements: ["success", "failed", "aborted"] }), column("creditsCharged", "integer", true, { min: 0 }), column("estimatedProviderCostMicrousd", "integer", false, { min: 0 }), varchar("providerRequestId", 128, false), varchar("errorType", 64, false),
    ],
    indexes: [index("userId_createdAt", ["userId", "$createdAt"], "key", ["ASC", "DESC"]), index("conversationId", ["conversationId"]), index("status", ["status"])],
  },
  purchases: {
    columns: [
      varchar("userId", 36), varchar("paymongoResourceId", 64), varchar("paymongoPaymentIntentId", 64, false), varchar("paymongoPaymentId", 64, false),
      column("type", "enum", true, { elements: ["payg", "starter", "power", "max"] }), column("amountPhpCentavos", "integer", true, { min: 1 }), column("credits", "integer", true, { min: 1 }), column("status", "enum", true, { elements: ["pending", "paid", "expired", "failed", "refunded"] }), varchar("idempotencyKey", 128), column("paidAt", "datetime", false),
    ],
    indexes: [index("userId_createdAt", ["userId", "$createdAt"], "key", ["ASC", "DESC"]), index("paymongoResourceId", ["paymongoResourceId"], "unique"), index("status", ["status"]), index("idempotencyKey", ["idempotencyKey"], "unique")],
  },
  users: {
    columns: [
      varchar("displayName", 128),
      column("avatarUrl", "url", false),
      column("role", "enum", false, {
        elements: ["user", "admin"],
        xdefault: "user",
      }),
    ],
    indexes: [],
  },
  conversations: {
    columns: [
      varchar("userId", 36),
      // A 120-character title expands to about 220 characters in a zenc envelope.
      varchar("title", 1024),
      varchar("modelId", 64),
      column("systemPrompt", "text", false),
      column("isPinned", "boolean", false, { xdefault: false }),
      column("isArchived", "boolean", false, { xdefault: false }),
      column("isDeleting", "boolean", false, { xdefault: false }),
      column("lastMessageAt", "datetime", false),
    ],
    indexes: [
      index("userId", ["userId"]),
      index("userId_lastMessageAt", ["userId", "lastMessageAt"], "key", [
        "ASC",
        "DESC",
      ]),
      index("userId_isArchived", ["userId", "isArchived"]),
    ],
  },
  messages: {
    columns: [
      varchar("conversationId", 36),
      varchar("userId", 36),
      column("role", "enum", true, {
        elements: ["user", "assistant", "system", "tool"],
      }),
      column("content", "longtext"),
      column("status", "enum", true, {
        elements: ["pending", "streaming", "completed", "failed"],
      }),
      varchar("parentMessageId", 36, false),
    ],
    indexes: [
      index("conversationId", ["conversationId"]),
      index(
        "conversationId_createdAt",
        ["conversationId", "$createdAt"],
        "key",
        ["ASC", "DESC"]
      ),
      index("userId", ["userId"]),
    ],
  },
  user_preferences: {
    columns: [
      varchar("userId", 36),
      varchar("defaultModelId", 64, false),
      column("customInstructions", "text", false),
    ],
    indexes: [index("userId", ["userId"], "unique")],
  },
  user_crypto_keys: {
    columns: [
      varchar("userId", 36),
      column("keyVersion", "integer", true, { min: 1 }),
      column("wrappedDek", "text"),
      varchar("kmsKeyArn", 2048),
      varchar("algorithm", 32),
    ],
    indexes: [],
  },
  attachments: {
    columns: [
      varchar("userId", 36),
      varchar("conversationId", 36),
      varchar("messageId", 36, false),
      varchar("storageFileId", 36),
      varchar("fileName", 180),
      varchar("mimeType", 128),
      column("sizeBytes", "integer", true, {
        min: 1,
        max: ATTACHMENT_LIMITS.fileBytes,
      }),
      column("kind", "enum", true, {
        elements: ["document", "image", "audio"],
      }),
      column("status", "enum", true, {
        elements: ["uploaded", "processing", "ready", "failed"],
      }),
      varchar("processor", 64, false),
      column("processedText", "longtext", false),
      varchar("errorCode", 64, false),
      column("metadata", "text", false),
    ],
    indexes: [
      index("userId", ["userId"]),
      index("conversationId", ["conversationId"]),
      index("messageId", ["messageId"]),
      index("status", ["status"]),
    ],
  },
  models: {
    columns: [
      varchar("slug", 64),
      varchar("name", 128),
      varchar("provider", 64),
      varchar("providerModelId", 128),
      column("description", "text", false),
      ...[
        "supportsVision",
        "supportsFiles",
        "supportsTools",
        "supportsReasoning",
        "isActive",
      ].map((key) => column(key, "boolean")),
      column("contextWindow", "integer", false, { min: 1 }),
      column("sortOrder", "integer", true, { min: 0 }),
    ],
    indexes: [index("slug", ["slug"], "unique")],
  },
}

// Only skip explicit conflicts. Permission, quota, and schema errors must stop setup.
async function createMissing(create) {
  try {
    await create()
  } catch (error) {
    if (error.code !== 409) throw error
  }
}

async function available(get, label) {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const resource = await get()
    if (resource.status === "available") return resource
    if (["failed", "stuck"].includes(resource.status))
      throw new Error(
        `${label} failed; inspect it in Appwrite before rerunning setup.`
      )
    await setTimeout(500)
  }
  throw new Error(
    `${label} is not ready. Rerun setup after Appwrite finishes provisioning.`
  )
}

export async function provision(tablesDB, databaseId, seed = true) {
  // Never silently create a different database if configuration is wrong.
  await tablesDB.get({ databaseId })
  for (const [tableId, definition] of Object.entries(schema)) {
    const base = { databaseId, tableId }
    const permissions =
      tableId === "models"
        ? [Permission.read(Role.users())]
          : ["users", "attachments", "usage_counters", "user_crypto_keys", "credit_accounts", "credit_transactions", "credit_reservations", "usage_events", "purchases"].includes(tableId)
          ? []
          : [Permission.create(Role.users())]
    const rowSecurity = tableId !== "models"
    await createMissing(() =>
      tablesDB.createTable({ ...base, name: tableId, permissions, rowSecurity })
    )
    const table = await tablesDB.getTable(base)
    if (!table.enabled)
      throw new Error(
        `${tableId} is disabled; enable it explicitly before setup.`
      )
    if (
      table.rowSecurity !== rowSecurity ||
      JSON.stringify([...table.$permissions].sort()) !==
        JSON.stringify([...permissions].sort())
    ) {
      await tablesDB.updateTable({ ...base, permissions, rowSecurity })
    }
    for (const spec of definition.columns) {
      const method = `create${spec.type[0].toUpperCase()}${spec.type.slice(1)}Column`
      const { type, ...options } = spec
      await createMissing(() => tablesDB[method]({ ...base, ...options }))
      const actual = await available(
        () => tablesDB.getColumn({ ...base, key: spec.key }),
        `${tableId}.${spec.key}`
      )
      // Appwrite reports string-family columns as type=string plus format/size.
      const actualType = actual.format || actual.type
      const expectedType = type === "varchar" ? "string" : type
      const compatibleType =
        actualType === type ||
        actualType === expectedType ||
        (actualType === "string" &&
          ["text", "longtext"].includes(type) &&
          actual.size >= (type === "longtext" ? 4_294_967_295 : 65_535))
      const needsVarcharExpansion =
        tableId === "conversations" &&
        spec.key === "title" &&
        type === "varchar" &&
        compatibleType &&
        actual.size < spec.size
      if (needsVarcharExpansion) {
        await tablesDB.updateVarcharColumn({
          ...base,
          key: spec.key,
          required: spec.required,
          size: spec.size,
          // TablesDB requires this field on updates; required columns cannot have a default.
          xdefault: spec.xdefault ?? null,
        })
        await available(
          () => tablesDB.getColumn({ ...base, key: spec.key }),
          `${tableId}.${spec.key}`
        )
      } else if (
        !compatibleType ||
        actual.required !== spec.required ||
        (spec.size !== undefined && actual.size !== spec.size) ||
        (spec.xdefault !== undefined && actual.default !== spec.xdefault) ||
        (spec.elements &&
          JSON.stringify(actual.elements) !== JSON.stringify(spec.elements))
      ) {
        throw new Error(
          `Existing column ${tableId}.${spec.key} differs from the schema. No data was deleted; reconcile it manually.`
        )
      }
    }
    for (const spec of definition.indexes) {
      await createMissing(() => tablesDB.createIndex({ ...base, ...spec }))
      const actual = await available(
        () => tablesDB.getIndex({ ...base, key: spec.key }),
        `${tableId}.${spec.key}`
      )
      if (
        actual.type !== spec.type ||
        JSON.stringify(actual.columns) !== JSON.stringify(spec.columns) ||
        (spec.orders &&
          JSON.stringify(actual.orders) !== JSON.stringify(spec.orders))
      ) {
        throw new Error(
          `Existing index ${tableId}.${spec.key} differs from the schema. Reconcile it manually.`
        )
      }
    }
    console.info(`Ready: ${tableId}`)
  }
  // Reconcile profile ACLs from earlier setups without changing profile data.
  // Profile writes are trusted-server only because Appwrite has no column-level ACLs.
  let cursor
  for (;;) {
    const { rows } = await tablesDB.listRows({
      databaseId,
      tableId: "users",
      total: false,
      queries: [
        Query.orderAsc("$id"),
        Query.limit(100),
        ...(cursor ? [Query.cursorAfter(cursor)] : []),
      ],
    })
    for (const row of rows) {
      const permissions = [Permission.read(Role.user(row.$id))]
      if (JSON.stringify(row.$permissions) !== JSON.stringify(permissions)) {
        await tablesDB.updateRow({
          databaseId,
          tableId: "users",
          rowId: row.$id,
          permissions,
        })
      }
    }
    if (rows.length < 100) break
    cursor = rows.at(-1).$id
  }
  if (seed) {
    for (const [sortOrder, model] of models.entries()) {
      await tablesDB.upsertRow({
        databaseId,
        tableId: "models",
        rowId: model.id,
        permissions: [],
        data: {
          slug: model.id,
          name: model.name,
          provider: model.provider,
          providerModelId: model.providerModelId,
          description: model.description,
          supportsVision: model.capabilities.image,
          supportsFiles: model.capabilities.files,
          supportsTools: model.capabilities.tools,
          supportsReasoning: model.capabilities.reasoning,
          contextWindow: null,
          isActive: true,
          sortOrder,
        },
      })
    }
    console.info(`Seeded ${models.length} models from lib/models.ts`)
  }
}

export async function provisionStorage(storage, bucketId) {
  const options = {
    bucketId,
    name: "attachments",
    permissions: [],
    fileSecurity: true,
    enabled: true,
    maximumFileSize: ATTACHMENT_LIMITS.fileBytes,
    allowedFileExtensions: Object.keys(ATTACHMENT_TYPES),
    encryption: true,
    antivirus: true,
  }
  await createMissing(() => storage.createBucket(options))
  const bucket = await storage.getBucket({ bucketId })
  if (!bucket.enabled)
    throw new Error(
      "Attachment bucket is disabled; enable it explicitly before setup."
    )
  await storage.updateBucket(options)
  console.info("Ready: private attachment bucket")
}

export async function provisionAttachmentFunction(functions) {
  const config = JSON.parse(
    readFileSync(new URL("../appwrite.config.json", import.meta.url), "utf8")
  )
  const {
    $id,
    name,
    runtime,
    execute,
    events,
    schedule,
    timeout,
    enabled,
    logging,
    entrypoint,
    commands,
    scopes,
    buildSpecification,
    runtimeSpecification,
  } = config.functions.find((item) => item.$id === "attachment-processor")
  const options = {
    functionId: $id,
    name,
    runtime,
    execute,
    events,
    schedule,
    timeout,
    enabled,
    logging,
    entrypoint,
    commands,
    scopes,
    buildSpecification,
    runtimeSpecification,
  }
  await createMissing(() => functions.create(options))
  await functions.update(options)
  console.info(
    "Ready: attachment-processor settings; configure variables and deploy code with the Appwrite CLI."
  )
}

export function setupFailureMessage(error) {
  if (!error?.code)
    return error instanceof Error ? error.message : "Appwrite setup failed."
  const argument =
    error.type === "general_argument_invalid" &&
    typeof error.message === "string"
      ? /^Invalid `([a-zA-Z][a-zA-Z0-9]*)` param:/.exec(error.message)?.[1]
      : undefined
  return `Appwrite setup failed (${error.code}, ${error.type}).${argument ? ` Rejected parameter: ${argument}.` : ""} Check configuration and key scopes.`
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const provisioningKey =
      process.env.APPWRITE_PROVISIONING_API_KEY || process.env.APPWRITE_API_KEY
    for (const key of [
      "NEXT_PUBLIC_APPWRITE_ENDPOINT",
      "NEXT_PUBLIC_APPWRITE_PROJECT_ID",
      "APPWRITE_DATABASE_ID",
      "APPWRITE_STORAGE_BUCKET_ID",
    ]) {
      if (!process.env[key]) throw new Error(`Missing ${key}`)
    }
    if (!provisioningKey)
      throw new Error(
        "Missing APPWRITE_PROVISIONING_API_KEY or APPWRITE_API_KEY"
      )
    const client = new Client()
      .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT)
      .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID)
      .setKey(provisioningKey)
    await provision(
      new TablesDB(client),
      process.env.APPWRITE_DATABASE_ID,
      !process.argv.includes("--no-seed")
    )
    await provisionStorage(
      new Storage(client),
      process.env.APPWRITE_STORAGE_BUCKET_ID
    )
    await provisionAttachmentFunction(new Functions(client))
  } catch (error) {
    // SDK exceptions can contain request details. Never dump credentials or response bodies.
    console.error(setupFailureMessage(error))
    process.exitCode = 1
  }
}
