import "server-only"

import { cache } from "react"
import {
  AppwriteException,
  ID,
  Permission,
  Query,
  Role,
  type Models,
} from "node-appwrite"
import {
  createAdminServerClient,
  createSessionClient,
} from "@/lib/appwrite-server"
import { getModel } from "@/lib/models"

export const RECENT_CONVERSATION_LIMIT = 100
export const MESSAGE_LIMIT = 100

export type Conversation = Models.Row & {
  userId: string
  title: string
  modelId: string
  systemPrompt?: string | null
  isPinned: boolean
  isArchived: boolean
  lastMessageAt?: string | null
}
export type Message = Models.Row & {
  conversationId: string
  userId: string
  role: "user" | "assistant" | "system" | "tool"
  content: string
  status: "pending" | "streaming" | "completed" | "failed"
  parentMessageId?: string | null
}
export type UserPreferences = Models.Row & {
  userId: string
  defaultModelId?: string | null
  customInstructions?: string | null
}

export class DbError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message)
  }
}

const session = cache(async () => {
  const client = await createSessionClient()
  if (!client) throw new DbError("Please sign in to continue.", 401)
  const user = await client.account.get()
  const databaseId = process.env.APPWRITE_DATABASE_ID
  if (!databaseId) throw new Error("APPWRITE_DATABASE_ID is required")
  const owner = Role.user(user.$id)
  return {
    ...client,
    user,
    databaseId,
    permissions: [
      Permission.read(owner),
      Permission.update(owner),
      Permission.delete(owner),
    ],
  }
})

function validId(id: string) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/.test(id))
    throw new DbError("Conversation not found.", 404)
}

function text(value: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new DbError(`Enter text between 1 and ${max} characters.`)
  return value.trim()
}

function validModel(modelId: string) {
  if (!getModel(modelId)) throw new DbError("Choose an available model.")
  return modelId
}

function missing(error: unknown) {
  return error instanceof AppwriteException && error.type === "row_not_found"
}

export async function ensureUser() {
  const { tablesDB, databaseId, user } = await session()
  const params = { databaseId, tableId: "users", rowId: user.$id }
  try {
    return await tablesDB.getRow(params)
  } catch (error) {
    if (!missing(error)) throw error
  }
  try {
    // Profiles contain a trusted role and use Auth IDs. Client creation/update would
    // allow role changes or claiming another user's profile ID. All reads use the session.
    await createAdminServerClient().tablesDB.createRow({
      ...params,
      permissions: [Permission.read(Role.user(user.$id))],
      data: { displayName: user.name || "Zenote user", role: "user" },
    })
  } catch (error) {
    if (!(error instanceof AppwriteException) || error.code !== 409) throw error
  }
  return tablesDB.getRow(params)
}

async function listConversationsByArchived(isArchived: boolean) {
  const { tablesDB, databaseId, user } = await session()
  const { rows } = await tablesDB.listRows<Conversation>({
    databaseId,
    tableId: "conversations",
    total: false,
    queries: [
      Query.equal("userId", user.$id),
      Query.equal("isArchived", isArchived),
      Query.orderDesc("lastMessageAt"),
      Query.orderDesc("$updatedAt"),
      Query.limit(RECENT_CONVERSATION_LIMIT),
    ],
  })
  // Appwrite's parser returns null-prototype rows, which React cannot serialize.
  return rows
    .map((row) => ({ ...row }))
    .sort((a, b) =>
      (b.lastMessageAt || b.$updatedAt).localeCompare(
        a.lastMessageAt || a.$updatedAt
      )
    )
}

export function listConversations() {
  return listConversationsByArchived(false)
}

export function listArchivedConversations() {
  return listConversationsByArchived(true)
}

export async function getConversation(id: string) {
  validId(id)
  const { tablesDB, databaseId, user } = await session()
  try {
    const row = await tablesDB.getRow<Conversation>({
      databaseId,
      tableId: "conversations",
      rowId: id,
    })
    // Defense in depth if a row was accidentally shared; ACLs remain the primary boundary.
    if (row.userId !== user.$id)
      throw new DbError("Conversation not found.", 404)
    return row
  } catch (error) {
    if (
      missing(error) ||
      (error instanceof AppwriteException && [401, 403].includes(error.code))
    )
      throw new DbError("Conversation not found.", 404)
    throw error
  }
}

export async function listMessages(conversationId: string) {
  await getConversation(conversationId)
  const { tablesDB, databaseId, user } = await session()
  const { rows } = await tablesDB.listRows<Message>({
    databaseId,
    tableId: "messages",
    total: false,
    queries: [
      Query.equal("conversationId", conversationId),
      Query.equal("userId", user.$id),
      Query.orderDesc("$createdAt"),
      Query.orderDesc("$id"),
      Query.limit(MESSAGE_LIMIT),
    ],
  })
  return rows.reverse()
}

export async function getUserMessage(
  conversationId: string,
  messageId: string
) {
  await getConversation(conversationId)
  validId(messageId)
  const { tablesDB, databaseId, user } = await session()
  const row = await tablesDB.getRow<Message>({
    databaseId,
    tableId: "messages",
    rowId: messageId,
  })
  if (
    row.userId !== user.$id ||
    row.conversationId !== conversationId ||
    row.role !== "user" ||
    row.status !== "completed"
  )
    throw new DbError("Message not found.", 404)
  return row
}

// The first prompt and its conversation, or a follow-up and its timestamp, commit together.
async function saveMessage(
  input: {
    conversationId?: string
    modelId: string
    role: "user" | "assistant"
    content: string
    parentMessageId?: string
  },
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  const content = text(
    input.content,
    input.role === "user" ? 32_000 : 1_000_000
  )
  const modelId = validModel(input.modelId)
  const existing = input.conversationId
    ? await getConversation(input.conversationId)
    : null
  if (!existing && input.role !== "user")
    throw new DbError("Conversation not found.", 404)
  if (input.parentMessageId)
    await getUserMessage(input.conversationId!, input.parentMessageId)
  const { tablesDB, databaseId, user, permissions } = await session()
  const conversationId = existing?.$id ?? ID.unique()
  const transaction = await tablesDB.createTransaction({ ttl: 60 })
  const transactionId = transaction.$id
  try {
    let conversation = existing
    if (!conversation) {
      conversation = await tablesDB.createRow<Conversation>({
        databaseId,
        tableId: "conversations",
        rowId: conversationId,
        transactionId,
        permissions,
        data: {
          userId: user.$id,
          title: content.replace(/\s+/g, " ").slice(0, 60).trim(),
          modelId,
          isPinned: false,
          isArchived: false,
          lastMessageAt: null,
        },
      })
    }
    const message = await tablesDB.createRow<Message>({
      databaseId,
      tableId: "messages",
      transactionId,
      permissions,
      // A completed response has a stable ID, preventing duplicate saves/replays for one prompt.
      rowId:
        input.role === "assistant" && input.parentMessageId
          ? `a_${input.parentMessageId}`.slice(0, 36)
          : ID.unique(),
      data: {
        conversationId,
        userId: user.$id,
        role: input.role,
        content: input.role === "user" ? content : input.content,
        status: "completed",
        parentMessageId: input.parentMessageId ?? null,
      },
    })
    conversation = await tablesDB.updateRow<Conversation>({
      databaseId,
      tableId: "conversations",
      rowId: conversationId,
      transactionId,
      data: { modelId, lastMessageAt: message.$createdAt },
    })
    signal?.throwIfAborted()
    await tablesDB.updateTransaction({ transactionId, commit: true })
    return { conversation: { ...conversation }, message: { ...message } }
  } catch (error) {
    await tablesDB
      .updateTransaction({ transactionId, rollback: true })
      .catch(() => {})
    throw error
  }
}

export async function createConversation(
  firstMessage: string,
  modelId: string
) {
  return saveMessage({ content: firstMessage, modelId, role: "user" })
}

export async function createMessage(
  conversationId: string,
  input: {
    modelId: string
    role: "user" | "assistant"
    content: string
    parentMessageId?: string
  },
  signal?: AbortSignal
) {
  return saveMessage({ ...input, conversationId }, signal)
}

export async function updateConversation(
  id: string,
  update: {
    title?: string
    isArchived?: boolean
    isPinned?: boolean
    modelId?: string
  }
) {
  await getConversation(id)
  const { tablesDB, databaseId } = await session()
  const data: typeof update = {}
  if (update.title !== undefined)
    data.title = text(update.title, 120).replace(/\s+/g, " ")
  if (update.modelId !== undefined) data.modelId = validModel(update.modelId)
  for (const key of ["isArchived", "isPinned"] as const) {
    if (update[key] !== undefined) {
      if (typeof update[key] !== "boolean")
        throw new DbError("Invalid conversation update.")
      data[key] = update[key]
    }
  }
  return tablesDB.updateRow<Conversation>({
    databaseId,
    tableId: "conversations",
    rowId: id,
    data,
  })
}

export async function deleteConversation(id: string) {
  await getConversation(id)
  const { tablesDB, databaseId, user } = await session()
  // Bulk delete requires table-wide privileges. Use bounded, individually authorized deletes instead.
  // Leave the parent until cleanup finishes so an interrupted deletion can be retried.
  for (;;) {
    const { rows } = await tablesDB.listRows<Message>({
      databaseId,
      tableId: "messages",
      total: false,
      queries: [
        Query.equal("conversationId", id),
        Query.equal("userId", user.$id),
        Query.limit(50),
      ],
    })
    if (!rows.length) break
    await Promise.all(
      rows.map((row) =>
        tablesDB.deleteRow({ databaseId, tableId: "messages", rowId: row.$id })
      )
    )
  }
  await tablesDB.deleteRow({ databaseId, tableId: "conversations", rowId: id })
}

export async function getUserPreferences() {
  const { tablesDB, databaseId, user } = await session()
  try {
    const row = await tablesDB.getRow<UserPreferences>({
      databaseId,
      tableId: "user_preferences",
      rowId: user.$id,
    })
    if (row.userId !== user.$id)
      throw new DbError("Preferences not found.", 404)
    return row
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
}

export async function updateUserPreferences(update: {
  defaultModelId?: string | null
  customInstructions?: string | null
}) {
  const { tablesDB, databaseId, user, permissions } = await session()
  const data: {
    userId: string
    defaultModelId?: string | null
    customInstructions?: string | null
  } = { userId: user.$id }
  if (update.defaultModelId !== undefined)
    data.defaultModelId =
      update.defaultModelId === null ? null : validModel(update.defaultModelId)
  if (update.customInstructions !== undefined) {
    if (
      update.customInstructions !== null &&
      (typeof update.customInstructions !== "string" ||
        update.customInstructions.length > 16_000)
    )
      throw new DbError("Custom instructions must be at most 16000 characters.")
    data.customInstructions = update.customInstructions
  }
  return tablesDB.upsertRow<UserPreferences>({
    databaseId,
    tableId: "user_preferences",
    rowId: user.$id,
    permissions,
    data,
  })
}
