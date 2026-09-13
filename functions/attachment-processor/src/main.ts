import { createHash, randomUUID } from "node:crypto"
import { Client, TablesDB, Storage, Permission, Role } from "node-appwrite"
import { LIMITS, ProcessingError, validateFile, isRecord } from "./policy.js"
import type {
  AttachmentKind,
  AttachmentStatus,
  ProcessingErrorCode,
  ProcessingLog,
  ProcessorResult,
} from "./policy.js"
import { processAttachment } from "./processor.js"
import { encryptAttachmentText as encryptProcessedText, type CryptoTables } from "./content-crypto.js"

const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/.test(id)

export interface FunctionPayload {
  attachmentId: string
}

export interface AttachmentRow {
  $id: string
  $permissions: string[]
  userId: string
  conversationId: string
  messageId: string
  storageFileId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  kind: AttachmentKind
  status: AttachmentStatus
  metadata: string | null
  processedText?: string | null
  processor?: string | null
  errorCode?: string | null
}

interface AttachmentMetadata extends Record<string, unknown> {
  hash: string
  queued?: string
  lease?: string
  admissionExpiresAt?: number
}

type Completion =
  | {
      status: "ready"
      processedText: string
      processor: ProcessorResult["processor"]
      errorCode: null
    }
  | {
      status: "failed"
      processedText: null
      processor: null
      errorCode: ProcessingErrorCode
    }

export type ExecutionResult =
  | { status: "ready" }
  | { status: "noop" }
  | { status: "failed"; code: ProcessingErrorCode }

export interface FunctionEnvironment {
  endpoint: string
  project: string
  key: string
  databaseId: string
  bucketId: string
  tableId: string
}

export interface ProcessingDependencies extends Pick<
  FunctionEnvironment,
  "databaseId" | "bucketId" | "tableId"
> {
  tablesDB: Pick<
    TablesDB,
    "createTransaction" | "getRow" | "updateRow" | "updateTransaction"
  > & CryptoTables
  storage: Pick<Storage, "getFile" | "getFileDownload">
  log: (message: string) => void
  encryptAttachmentText?: typeof encryptProcessedText
}

interface FunctionContext {
  req: {
    method: string
    bodyJson: unknown
    headers: Record<string, string | undefined>
  }
  res: { json: (body: ExecutionResult, statusCode?: number) => unknown }
  log: (message: string) => void
  error: (message: string) => void
}

function readAttachmentRow(value: unknown): AttachmentRow {
  if (
    !isRecord(value) ||
    !validId(value.$id) ||
    !Array.isArray(value.$permissions) ||
    !value.$permissions.every(
      (permission: unknown) => typeof permission === "string"
    ) ||
    !validId(value.userId) ||
    !validId(value.conversationId) ||
    !validId(value.messageId) ||
    typeof value.storageFileId !== "string" ||
    typeof value.fileName !== "string" ||
    typeof value.mimeType !== "string" ||
    typeof value.sizeBytes !== "number" ||
    (value.kind !== "document" &&
      value.kind !== "image" &&
      value.kind !== "audio") ||
    (value.status !== "uploaded" &&
      value.status !== "processing" &&
      value.status !== "ready" &&
      value.status !== "failed") ||
    (value.metadata !== null && typeof value.metadata !== "string") ||
    [value.processedText, value.processor, value.errorCode].some(
      (field) => field != null && typeof field !== "string"
    )
  )
    throw new ProcessingError("invalid_state")
  return value as unknown as AttachmentRow
}

function readMetadata(value: string | null): AttachmentMetadata {
  let metadata: unknown
  try {
    metadata = JSON.parse(value || "{}")
  } catch {
    throw new ProcessingError("invalid_state")
  }
  if (
    !isRecord(metadata) ||
    typeof metadata.hash !== "string" ||
    !/^[a-f0-9]{64}$/.test(metadata.hash) ||
    (metadata.queued !== undefined && typeof metadata.queued !== "string") ||
    (metadata.lease !== undefined && typeof metadata.lease !== "string") ||
    (metadata.admissionExpiresAt !== undefined &&
      (typeof metadata.admissionExpiresAt !== "number" || !Number.isSafeInteger(metadata.admissionExpiresAt)))
  )
    throw new ProcessingError("invalid_state")
  return metadata as AttachmentMetadata
}

// Transactions fence duplicate executions and deletion; no session or permanent key is used.
export async function runAttachment(
  attachmentId: string,
  {
    tablesDB,
    storage,
    databaseId,
    tableId,
    bucketId,
    log,
    encryptAttachmentText = encryptProcessedText,
  }: ProcessingDependencies,
  process: typeof processAttachment = processAttachment
): Promise<ExecutionResult> {
  if (!validId(attachmentId)) throw new ProcessingError("invalid_request")
  const started = Date.now()
  const params = { databaseId, tableId, rowId: attachmentId }
  let lease: string | undefined
  let claimed: AttachmentRow | null
  let claimedHash: string | undefined
  async function transition(
    finish?: Completion
  ): Promise<AttachmentRow | null> {
    const transaction = await tablesDB.createTransaction({ ttl: 60 })
    const transactionId = transaction.$id
    try {
      const snapshot = readAttachmentRow(
        await tablesDB.getRow({ ...params, transactionId })
      )
      // Capture the write revision before deciding whether a queued attempt may
      // start. A claim between an ordinary read and its first write must be seen.
      await tablesDB.updateRow({
        ...params, transactionId, data: { sizeBytes: snapshot.sizeBytes },
      })
      const row = readAttachmentRow(
        await tablesDB.getRow({ ...params, transactionId })
      )
      if (
        ![row.userId, row.conversationId, row.messageId].every(validId) ||
        row.storageFileId !== row.$id ||
        row.$id !== attachmentId
      )
        throw new ProcessingError("invalid_state")
      const expectedPermissions = [Permission.read(Role.user(row.userId))]
      if (
        JSON.stringify(row.$permissions) !== JSON.stringify(expectedPermissions)
      )
        throw new ProcessingError("invalid_state")
      const parent: unknown = await tablesDB.getRow({
        databaseId,
        tableId: "conversations",
        rowId: row.conversationId,
        transactionId,
      })
      const message: unknown = await tablesDB.getRow({
        databaseId,
        tableId: "messages",
        rowId: row.messageId,
        transactionId,
      })
      if (
        !isRecord(parent) ||
        !validId(parent.$id) ||
        (parent.lastMessageAt != null &&
          typeof parent.lastMessageAt !== "string") ||
        !isRecord(message) ||
        parent.userId !== row.userId ||
        parent.isDeleting ||
        message.userId !== row.userId ||
        message.conversationId !== row.conversationId ||
        message.role !== "user" ||
        message.status !== "completed"
      )
        throw new ProcessingError("invalid_state")
      const type = validateFile(row.fileName, row.sizeBytes)
      const metadata = readMetadata(row.metadata)
      if (type.kind !== row.kind || type.mime !== row.mimeType)
        throw new ProcessingError("invalid_state")
      if (finish) {
        if (
          row.status !== "processing" ||
          metadata.lease !== lease ||
          metadata.hash !== claimedHash
        )
          throw new ProcessingError("lease_lost")
        delete metadata.lease
        delete metadata.queued
      } else {
        // Only the Site can authorize a new attempt. Delayed duplicates of failed jobs are no-ops.
        if (row.status !== "processing" || !metadata.queued || metadata.lease ||
            (metadata.admissionExpiresAt !== undefined && Date.now() >= metadata.admissionExpiresAt)) {
          await tablesDB.updateTransaction({ transactionId, rollback: true })
          return null
        }
        lease = randomUUID()
        metadata.lease = lease
        claimedHash = metadata.hash
      }
      // Conflict with the conversation tombstone rather than committing after deletion starts.
      await tablesDB.updateRow({
        databaseId,
        tableId: "conversations",
        rowId: parent.$id,
        transactionId,
        data: { lastMessageAt: parent.lastMessageAt ?? null },
      })
      const fencedParent = await tablesDB.getRow({
        databaseId, tableId: "conversations", rowId: parent.$id, transactionId,
      })
      if (!isRecord(fencedParent) || fencedParent.isDeleting)
        throw new ProcessingError("invalid_state")
      const updated = await tablesDB.updateRow({
        ...params,
        transactionId,
        data: {
          ...(finish ?? { status: "processing", errorCode: null }),
          metadata: JSON.stringify(metadata),
        },
      })
      await tablesDB.updateTransaction({ transactionId, commit: true })
      return readAttachmentRow(updated)
    } catch (error) {
      await tablesDB
        .updateTransaction({ transactionId, rollback: true })
        .catch(() => {})
      throw error
    }
  }
  try {
    claimed = await transition()
  } catch (error) {
    if (isRecord(error) && (error.code === 409 || error.code === 404))
      return { status: "noop" }
    throw error
  }
  if (!claimed) return { status: "noop" }
  const active = claimed
  const emit = (fields: ProcessingLog): void =>
    log(
      JSON.stringify({
        attachmentId,
        kind: active.kind,
        bytes: active.sizeBytes,
        elapsedMs: Date.now() - started,
        ...fields,
      })
    )
  emit({ event: "attachment.processing.started" })
  const signal = AbortSignal.timeout(LIMITS.processingMs)
  try {
    const fileParams = { bucketId, fileId: active.storageFileId }
    const file = await storage.getFile(fileParams)
    if (
      file.$id !== active.storageFileId ||
      file.name !== active.fileName ||
      file.sizeOriginal !== active.sizeBytes ||
      file.chunksUploaded !== file.chunksTotal ||
      JSON.stringify(file.$permissions) !== JSON.stringify(active.$permissions)
    )
      throw new ProcessingError("invalid_file")
    const bytes = Buffer.from(await storage.getFileDownload(fileParams))
    if (
      bytes.length !== active.sizeBytes ||
      createHash("sha256").update(bytes).digest("hex") !== claimedHash
    )
      throw new ProcessingError("hash_mismatch")
    signal.throwIfAborted()
    const result = await process(
      { fileName: active.fileName, bytes },
      signal,
      emit
    )
    signal.throwIfAborted()
    const processedText = await encryptAttachmentText(
      tablesDB,
      databaseId,
      active.userId,
      active.$id,
      result.text
    )
    await transition({
      status: "ready",
      processedText,
      processor: result.processor,
      errorCode: null,
    })
    emit({ event: "attachment.processing.ready", processor: result.processor })
    return { status: "ready" }
  } catch (error) {
    const code = signal.aborted
      ? "interrupted"
      : error instanceof ProcessingError
        ? error.code
        : "processing_failed"
    try {
      await transition({
        status: "failed",
        processedText: null,
        processor: null,
        errorCode: code,
      })
    } catch {
      // Deleted or superseded rows must not be resurrected. Stale leases are explicitly retryable.
      emit({
        event: "attachment.processing.failed",
        code: "state_write_failed",
      })
      throw new ProcessingError("state_write_failed")
    }
    emit({ event: "attachment.processing.failed", code })
    return { status: "failed", code }
  }
}

export default async function main({
  req,
  res,
  log,
  error,
}: FunctionContext): Promise<unknown> {
  try {
    const body = req.bodyJson
    if (
      req.method !== "POST" ||
      !isRecord(body) ||
      Object.keys(body).length !== 1 ||
      !validId(body.attachmentId)
    )
      throw new ProcessingError("invalid_request")
    const payload: FunctionPayload = { attachmentId: body.attachmentId }
    const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT
    const project = process.env.APPWRITE_FUNCTION_PROJECT_ID
    const key = req.headers["x-appwrite-key"]
    const databaseId = process.env.ZENOTE_DATABASE_ID
    const bucketId = process.env.ZENOTE_STORAGE_BUCKET_ID
    if (!endpoint || !project || !key || !databaseId || !bucketId)
      throw new ProcessingError("configuration")
    const env: FunctionEnvironment = {
      endpoint,
      project,
      key,
      databaseId,
      bucketId,
      tableId: process.env.ZENOTE_ATTACHMENTS_TABLE_ID || "attachments",
    }
    const client = new Client()
      .setEndpoint(env.endpoint)
      .setProject(env.project)
      .setKey(env.key)
    const result = await runAttachment(payload.attachmentId, {
      tablesDB: new TablesDB(client),
      storage: new Storage(client),
      databaseId: env.databaseId,
      tableId: env.tableId,
      bucketId: env.bucketId,
      log,
    })
    return res.json(result)
  } catch (failure) {
    const code =
      failure instanceof ProcessingError ? failure.code : "processing_failed"
    error(JSON.stringify({ event: "attachment.processing.failed", code }))
    return res.json(
      { status: "failed", code },
      code === "invalid_request" ? 400 : 500
    )
  }
}
