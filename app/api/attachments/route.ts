import { getCurrentUser } from "@/lib/auth"
import { AdmissionError } from "@/lib/admission"
import {
  createAttachment,
  DbError,
  deleteAttachment,
  getUserMessage,
  listConversationAttachments,
  queueAttachment,
} from "@/lib/db"
import {
  ATTACHMENT_LIMITS,
  AttachmentError,
  attachmentSummary,
  validateAttachmentFile,
} from "@/lib/attachment-policy"
import { isAppwriteId, isSameOriginRequest } from "@/lib/request-security"

export const runtime = "nodejs"

async function handle(request: Request) {
  try {
    if (!(await getCurrentUser()))
      throw new AttachmentError(
        "auth",
        "Please sign in to use attachments.",
        401
      )
    if (request.method !== "GET" && !isSameOriginRequest(request))
      throw new AttachmentError("origin", "Invalid request origin.", 403)
    const params = new URL(request.url).searchParams
    if (request.method === "DELETE") {
      const id = params.get("id")
      if (!isAppwriteId(id))
        throw new AttachmentError(
          "invalid_request",
          "The attachment request is invalid."
        )
      await deleteAttachment(id)
      return Response.json(
        { ok: true },
        { headers: { "Cache-Control": "no-store" } }
      )
    }
    if (request.method === "PATCH") {
      const id = params.get("id")
      if (!isAppwriteId(id))
        throw new AttachmentError(
          "invalid_request",
          "The attachment request is invalid."
        )
      const row = await queueAttachment(id)
      return Response.json(
        { attachment: attachmentSummary(row) },
        { status: 202, headers: { "Cache-Control": "no-store" } }
      )
    }
    const conversationId = params.get("conversationId") ?? ""
    const messageId = params.get("messageId") ?? ""
    if (!isAppwriteId(conversationId) || !isAppwriteId(messageId))
      throw new AttachmentError(
        "invalid_request",
        "The attachment request is invalid."
      )
    await getUserMessage(conversationId, messageId)
    if (request.method === "GET") {
      const rows = await listConversationAttachments(conversationId, [
        messageId,
      ])
      return Response.json(
        { attachments: rows.map(attachmentSummary) },
        { headers: { "Cache-Control": "no-store" } }
      )
    }
    const name = params.get("name") ?? ""
    const slot = Number(params.get("slot"))
    if (
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot >= ATTACHMENT_LIMITS.count
    )
      throw new AttachmentError("count", "Attach up to four files per message.")
    const contentLength = request.headers.get("content-length")
    const declaredSize = contentLength === null ? undefined : Number(contentLength)
    if (
      declaredSize !== undefined &&
      (!Number.isSafeInteger(declaredSize) || declaredSize <= 0)
    )
      throw new AttachmentError(
        "invalid_size",
        "The upload size is invalid.",
        400
      )
    if (declaredSize !== undefined && declaredSize > ATTACHMENT_LIMITS.fileBytes)
      throw new AttachmentError(
        "file_too_large",
        "Files must be 5 MB or smaller.",
        413
      )
    const expectedType = validateAttachmentFile(name, 1)
    const suppliedType = request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase()
    if (
      suppliedType &&
      suppliedType !== "application/octet-stream" &&
      suppliedType !== expectedType.mime
    )
      throw new AttachmentError(
        "invalid_type",
        "The file content type does not match its filename.",
        400
      )
    const reader = request.body?.getReader()
    if (!reader)
      throw new AttachmentError("empty_file", "Choose a non-empty file.")
    const chunks: Uint8Array[] = []
    let size = 0
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(60_000),
    ])
    const abort = () => {
      void reader.cancel().catch(() => {})
    }
    signal.addEventListener("abort", abort, { once: true })
    try {
      for (;;) {
        signal.throwIfAborted()
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        validateAttachmentFile(name, size)
        chunks.push(value)
      }
      signal.throwIfAborted()
    } finally {
      signal.removeEventListener("abort", abort)
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    if (declaredSize !== undefined && size !== declaredSize)
      throw new AttachmentError(
        "invalid_size",
        "The upload size does not match its content length.",
        400
      )
    const bytes = Buffer.concat(chunks, size)
    const type = validateAttachmentFile(name, bytes.length)
    const row = await createAttachment({
      conversationId,
      messageId,
      slot,
      fileName: name,
      mimeType: type.mime,
      kind: type.kind,
      bytes,
    })
    return Response.json(
      { attachment: attachmentSummary(await queueAttachment(row.$id)) },
      { status: 202, headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    const safe = error instanceof AttachmentError || error instanceof DbError || error instanceof AdmissionError
    return Response.json(
      {
        error: safe
          ? error.message
          : "The attachment could not be saved or processed. Please try again.",
        ...(error instanceof AttachmentError || error instanceof AdmissionError ? { code: error.code } : {}),
        ...(error instanceof AdmissionError && error.retryAfter ? { retryAfter: error.retryAfter } : {}),
      },
      {
        status: safe ? error.status : 503,
        headers: { "Cache-Control": "no-store", ...(error instanceof AdmissionError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) },
      }
    )
  }
}

export const POST = handle
export const PATCH = handle
export const DELETE = handle
export const GET = handle
