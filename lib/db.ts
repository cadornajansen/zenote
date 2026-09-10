import "server-only"

import { cache } from "react"
import { createHash } from "node:crypto"
import { InputFile } from "node-appwrite/file"
import {
  ATTACHMENT_LIMITS,
  AttachmentError,
  type AttachmentKind,
  type AttachmentStatus,
} from "@/lib/attachment-policy"
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
  isDeleting?: boolean
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
export type AttachmentRow = Models.Row & {
  userId: string
  conversationId: string
  messageId: string | null
  storageFileId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  kind: AttachmentKind
  status: AttachmentStatus
  processor?: string | null
  processedText?: string | null
  errorCode?: string | null
  metadata?: string | null
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

function retryableReadError(error: unknown) {
  const code =
    error instanceof AppwriteException
      ? error.code
      : error instanceof TypeError && error.message === "fetch failed"
        ? 0
        : undefined
  return (
    code === 0 ||
    code === 408 ||
    code === 429 ||
    (typeof code === "number" && code >= 500)
  )
}

async function retryRead<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (!retryableReadError(error) || attempt === 2) throw error
      await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt))
    }
  }
  throw new Error("Unreachable")
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
  const { rows } = await retryRead(() => tablesDB.listRows<Conversation>({
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
  }))
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

export async function getConversation(id: string, allowDeleting = false) {
  validId(id)
  const { tablesDB, databaseId, user } = await session()
  try {
    const row = await retryRead(() => tablesDB.getRow<Conversation>({
      databaseId,
      tableId: "conversations",
      rowId: id,
    }))
    // Defense in depth if a row was accidentally shared; ACLs remain the primary boundary.
    if (row.userId !== user.$id || (row.isDeleting && !allowDeleting))
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
  const { rows } = await retryRead(() => tablesDB.listRows<Message>({
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
  }))
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
  const rowId =
    input.role === "assistant" && input.parentMessageId
      ? `a_${input.parentMessageId}`.slice(0, 36)
      : ID.unique()
  if (input.role === "assistant" && input.parentMessageId) {
    try {
      const existingMessage = await tablesDB.getRow<Message>({
        databaseId,
        tableId: "messages",
        rowId,
      })
      if (
        existingMessage.userId !== user.$id ||
        existingMessage.conversationId !== conversationId ||
        existingMessage.role !== "assistant" ||
        existingMessage.parentMessageId !== input.parentMessageId ||
        existingMessage.content !== input.content
      )
        throw new DbError("Response already exists.", 409)
      return { conversation: { ...existing }, message: { ...existingMessage } }
    } catch (error) {
      if (!(error instanceof AppwriteException) || error.code !== 404)
        throw error
    }
  }
  const transaction = await tablesDB.createTransaction({ ttl: 60 })
  const transactionId = transaction.$id
  try {
    if (existing) {
      const current = await tablesDB.getRow<Conversation>({
        databaseId,
        tableId: "conversations",
        rowId: conversationId,
        transactionId,
      })
      if (current.isDeleting || current.userId !== user.$id)
        throw new DbError("Conversation not found.", 404)
    }
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
      rowId,
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
  await getConversation(id, true)
  const { tablesDB, databaseId, user } = await session()
  // A durable tombstone prevents new uploads/messages racing a paged deletion.
  await tablesDB.updateRow({
    databaseId,
    tableId: "conversations",
    rowId: id,
    data: { isDeleting: true },
  })
  for (;;) {
    const rows = await listConversationAttachments(id, undefined, true)
    if (!rows.length) break
    for (const row of rows) await deleteAttachment(row.$id, true)
  }
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

function attachmentBucket() {
  const bucketId = process.env.APPWRITE_STORAGE_BUCKET_ID
  if (!bucketId)
    throw new AttachmentError(
      "unavailable",
      "Attachments are temporarily unavailable.",
      503
    )
  return bucketId
}

export async function getAttachment(id: string, allowDeleting = false) {
  validId(id)
  const { tablesDB, databaseId, user } = await session()
  try {
    const row = await tablesDB.getRow<AttachmentRow>({
      databaseId,
      tableId: "attachments",
      rowId: id,
    })
    if (
      row.userId !== user.$id ||
      JSON.stringify(row.$permissions) !==
        JSON.stringify([Permission.read(Role.user(user.$id))])
    )
      throw new DbError("Attachment not found.", 404)
    await getConversation(row.conversationId, allowDeleting)
    return row
  } catch (error) {
    if (
      error instanceof AppwriteException &&
      [401, 403, 404].includes(error.code)
    )
      throw new DbError("Attachment not found.", 404)
    throw error
  }
}

export async function listConversationAttachments(
  conversationId: string,
  messageIds?: string[],
  allowDeleting = false
) {
  await getConversation(conversationId, allowDeleting)
  if (messageIds && !messageIds.length) return []
  const { tablesDB, databaseId, user } = await session()
  const { rows } = await retryRead(() => tablesDB.listRows<AttachmentRow>({
    databaseId,
    tableId: "attachments",
    total: false,
    queries: [
      Query.equal("userId", user.$id),
      Query.equal("conversationId", conversationId),
      ...(messageIds
        ? [Query.equal("messageId", messageIds.slice(0, MESSAGE_LIMIT))]
        : []),
      Query.orderAsc("$id"),
      Query.limit(messageIds ? MESSAGE_LIMIT * ATTACHMENT_LIMITS.count : 50),
    ],
  }))
  if (
    rows.some(
      (row) =>
        row.userId !== user.$id ||
        row.conversationId !== conversationId ||
        JSON.stringify(row.$permissions) !==
          JSON.stringify([Permission.read(Role.user(user.$id))])
    )
  )
    throw new DbError(
      "Attachment permissions need administrator attention.",
      503
    )
  return rows.map((row) => ({ ...row }))
}

export async function createAttachment(input: {
  conversationId: string
  messageId: string
  slot: number
  fileName: string
  mimeType: string
  kind: AttachmentKind
  bytes: Buffer
}) {
  await getUserMessage(input.conversationId, input.messageId)
  if (
    !Number.isInteger(input.slot) ||
    input.slot < 0 ||
    input.slot >= ATTACHMENT_LIMITS.count
  )
    throw new AttachmentError("count", "Attach up to four files per message.")
  const { databaseId, user } = await session()
  const admin = createAdminServerClient()
  const rowId = createHash("sha256")
    .update(`${user.$id}:${input.messageId}:${input.slot}`)
    .digest("hex")
    .slice(0, 36)
  const hash = createHash("sha256").update(input.bytes).digest("hex")
  const bucketId = attachmentBucket()
  const permissions = [Permission.read(Role.user(user.$id))]
  let existing: AttachmentRow | undefined
  try {
    existing = await getAttachment(rowId)
  } catch (error) {
    if (!(error instanceof DbError && error.status === 404)) throw error
  }
  // Reserve a durable reference before uploading, so interrupted uploads remain discoverable for cleanup.
  if (!existing) {
    const transaction = await admin.tablesDB.createTransaction({ ttl: 60 })
    try {
      const conversation = await admin.tablesDB.getRow<Conversation>({
        databaseId,
        tableId: "conversations",
        rowId: input.conversationId,
        transactionId: transaction.$id,
      })
      if (conversation.userId !== user.$id || conversation.isDeleting)
        throw new DbError("Conversation not found.", 404)
      // Touch the parent in the same transaction so deletion conflicts rather than orphaning this row.
      await admin.tablesDB.updateRow({
        databaseId,
        tableId: "conversations",
        rowId: input.conversationId,
        transactionId: transaction.$id,
        data: { lastMessageAt: conversation.lastMessageAt ?? null },
      })
      await admin.tablesDB.createRow<AttachmentRow>({
        databaseId,
        tableId: "attachments",
        rowId,
        transactionId: transaction.$id,
        permissions,
        data: {
          userId: user.$id,
          conversationId: input.conversationId,
          messageId: input.messageId,
          storageFileId: rowId,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.bytes.length,
          kind: input.kind,
          status: "uploaded",
          metadata: JSON.stringify({ hash }),
        },
      })
      await admin.tablesDB.updateTransaction({
        transactionId: transaction.$id,
        commit: true,
      })
    } catch (error) {
      await admin.tablesDB
        .updateTransaction({ transactionId: transaction.$id, rollback: true })
        .catch(() => {})
      // A concurrent reservation or lost commit response is resolved by the stable slot below.
      existing = await getAttachment(rowId).catch(() => undefined)
      if (!existing) throw error
    }
    existing = await getAttachment(rowId)
  }
  if (
    JSON.parse(existing.metadata || "{}").hash !== hash ||
    existing.fileName !== input.fileName ||
    existing.conversationId !== input.conversationId
  )
    throw new AttachmentError(
      "slot_used",
      "This attachment slot is already used. Remove the original file first.",
      409
    )
  const fileParams = { bucketId, fileId: rowId }
  const { storage } = await session()
  try {
    const file = await storage.getFile(fileParams)
    if (
      JSON.stringify(file.$permissions) !== JSON.stringify(permissions) ||
      file.sizeOriginal !== input.bytes.length
    )
      throw new DbError("Attachment not found.", 404)
    if (file.chunksUploaded === file.chunksTotal) {
      const stored = await storage.getFileDownload(fileParams)
      if (
        createHash("sha256").update(Buffer.from(stored)).digest("hex") !== hash
      )
        throw new AttachmentError(
          "invalid_file",
          "The stored file does not match this upload. Remove it and try again.",
          409
        )
      return { ...existing }
    }
    if (Date.now() - Date.parse(file.$updatedAt) < ATTACHMENT_LIMITS.leaseMs)
      throw new AttachmentError(
        "busy",
        "This upload is already in progress. Try again shortly.",
        409
      )
    await admin.storage.deleteFile(fileParams)
  } catch (error) {
    if (!(error instanceof AppwriteException && error.code === 404)) throw error
  }
  try {
    await admin.storage.createFile({
      ...fileParams,
      file: InputFile.fromBuffer(input.bytes, input.fileName),
      permissions,
    })
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 409)
      throw new AttachmentError(
        "busy",
        "This upload is already in progress. Try again shortly.",
        409
      )
    await admin.storage.deleteFile(fileParams).catch(() => {})
    throw error
  }
  try {
    // Deletion may have finished while Storage was receiving the bytes.
    const row = await getAttachment(rowId)
    if (JSON.parse(row.metadata || "{}").hash !== hash)
      throw new AttachmentError(
        "slot_used",
        "This attachment changed during upload. Remove it and try again.",
        409
      )
    return { ...row }
  } catch (error) {
    if (error instanceof DbError && error.status === 404)
      await admin.storage.deleteFile(fileParams).catch(() => {})
    throw error
  }
}

export async function downloadAttachment(id: string) {
  const row = await getAttachment(id)
  const { storage, user } = await session()
  const params = { bucketId: attachmentBucket(), fileId: row.storageFileId }
  const file = await storage.getFile(params)
  if (
    row.storageFileId !== row.$id ||
    file.chunksUploaded !== file.chunksTotal ||
    file.sizeOriginal !== row.sizeBytes ||
    file.sizeOriginal > ATTACHMENT_LIMITS.fileBytes ||
    JSON.stringify(file.$permissions) !==
      JSON.stringify([Permission.read(Role.user(user.$id))])
  )
    throw new DbError("Attachment not found.", 404)
  const bytes = Buffer.from(await storage.getFileDownload(params))
  if (
    bytes.length !== row.sizeBytes ||
    createHash("sha256").update(bytes).digest("hex") !==
      JSON.parse(row.metadata || "{}").hash
  )
    throw new DbError(
      "The stored attachment could not be verified. Remove it and try again.",
      409
    )
  return bytes
}

async function reserveAttachmentExecution(id: string) {
  const authorized = await getAttachment(id)
  await getUserMessage(authorized.conversationId, authorized.messageId ?? "")
  const { databaseId, user } = await session()
  const { tablesDB } = createAdminServerClient()
  const transaction = await tablesDB.createTransaction({ ttl: 60 })
  try {
    const params = {
      databaseId,
      tableId: "attachments",
      rowId: id,
      transactionId: transaction.$id,
    }
    const row = await tablesDB.getRow<AttachmentRow>(params)
    const parent = await tablesDB.getRow<Conversation>({
      databaseId,
      tableId: "conversations",
      rowId: row.conversationId,
      transactionId: transaction.$id,
    })
    if (
      row.userId !== user.$id ||
      parent.userId !== user.$id ||
      parent.isDeleting
    )
      throw new DbError("Attachment not found.", 404)
    if (row.status === "ready" && row.processedText) {
      await tablesDB.updateTransaction({
        transactionId: transaction.$id,
        rollback: true,
      })
      return { row, queued: null }
    }
    if (
      row.status === "processing" &&
      Date.now() - Date.parse(row.$updatedAt) < ATTACHMENT_LIMITS.leaseMs
    ) {
      await tablesDB.updateTransaction({
        transactionId: transaction.$id,
        rollback: true,
      })
      return { row, queued: null }
    }
    const queued = crypto.randomUUID()
    const metadata = JSON.parse(row.metadata || "{}")
    delete metadata.lease
    await tablesDB.updateRow({
      databaseId,
      tableId: "conversations",
      rowId: parent.$id,
      transactionId: transaction.$id,
      data: { lastMessageAt: parent.lastMessageAt ?? null },
    })
    const updated = await tablesDB.updateRow<AttachmentRow>({
      ...params,
      data: {
        status: "processing",
        errorCode: null,
        metadata: JSON.stringify({
          ...metadata,
          queued,
        }),
      },
    })
    await tablesDB.updateTransaction({
      transactionId: transaction.$id,
      commit: true,
    })
    return { row: updated, queued }
  } catch (error) {
    await tablesDB
      .updateTransaction({ transactionId: transaction.$id, rollback: true })
      .catch(() => {})
    if (error instanceof AppwriteException && error.code === 409)
      throw new AttachmentError(
        "busy",
        "This attachment is still processing. Try again shortly.",
        409
      )
    throw error
  }
}

async function releaseAttachmentExecution(id: string, queued: string) {
  await getAttachment(id)
  const { databaseId, user } = await session()
  const { tablesDB } = createAdminServerClient()
  const transaction = await tablesDB.createTransaction({ ttl: 60 })
  try {
    const params = {
      databaseId,
      tableId: "attachments",
      rowId: id,
      transactionId: transaction.$id,
    }
    const row = await tablesDB.getRow<AttachmentRow>(params)
    const parent = await tablesDB.getRow<Conversation>({
      databaseId,
      tableId: "conversations",
      rowId: row.conversationId,
      transactionId: transaction.$id,
    })
    if (
      row.userId !== user.$id ||
      parent.userId !== user.$id ||
      parent.isDeleting
    )
      throw new DbError("Attachment not found.", 404)
    const metadata = JSON.parse(row.metadata || "{}")
    if (
      metadata.queued !== queued ||
      metadata.lease ||
      row.status !== "processing"
    )
      throw new AttachmentError(
        "busy",
        "Attachment processing changed. Please retry.",
        409
      )
    delete metadata.queued
    const updated = await tablesDB.updateRow<AttachmentRow>({
      ...params,
      data: {
        status: "uploaded",
        errorCode: "enqueue_failed",
        metadata: JSON.stringify(metadata),
      },
    })
    await tablesDB.updateTransaction({
      transactionId: transaction.$id,
      commit: true,
    })
    return updated
  } catch (error) {
    await tablesDB
      .updateTransaction({ transactionId: transaction.$id, rollback: true })
      .catch(() => {})
    throw error
  }
}

export async function queueAttachment(id: string) {
  // Verify the canonical private upload before reserving an attempt. Never parse it here.
  await downloadAttachment(id)
  const { row, queued } = await reserveAttachmentExecution(id)
  if (!queued) return row
  try {
    await createAdminServerClient().functions.createExecution({
      functionId: "attachment-processor",
      body: JSON.stringify({ attachmentId: id }),
      async: true,
    })
  } catch {
    await releaseAttachmentExecution(id, queued).catch(() => {})
    throw new AttachmentError(
      "enqueue_failed",
      "Attachment processing could not be queued. Please retry.",
      503
    )
  }
  return row
}

export async function deleteAttachment(id: string, allowDeleting = false) {
  const row = await getAttachment(id, allowDeleting)
  const { databaseId, storage } = await session()
  const admin = createAdminServerClient()
  const params = { bucketId: attachmentBucket(), fileId: row.storageFileId }
  try {
    // Session read proves file access before the restricted server-only delete.
    const file = await storage.getFile(params)
    if (JSON.stringify(file.$permissions) !== JSON.stringify(row.$permissions))
      throw new DbError("Attachment not found.", 404)
    await admin.storage.deleteFile(params)
  } catch (error) {
    if (!(error instanceof AppwriteException && error.code === 404)) throw error
  }
  await admin.tablesDB.deleteRow({
    databaseId,
    tableId: "attachments",
    rowId: id,
  })
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
