import { getCurrentUser } from "@/lib/auth"
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

export const runtime = "nodejs"

async function handle(request: Request) {
  try {
    if (!(await getCurrentUser()))
      throw new AttachmentError(
        "auth",
        "Please sign in to use attachments.",
        401
      )
    const origin = request.headers.get("origin")
    if (origin && origin !== new URL(request.url).origin)
      throw new AttachmentError("origin", "Invalid request origin.", 403)
    const params = new URL(request.url).searchParams
    if (request.method === "DELETE") {
      await deleteAttachment(params.get("id") ?? "")
      return Response.json(
        { ok: true },
        { headers: { "Cache-Control": "no-store" } }
      )
    }
    if (request.method === "PATCH") {
      const row = await queueAttachment(params.get("id") ?? "")
      return Response.json(
        { attachment: attachmentSummary(row) },
        { status: 202, headers: { "Cache-Control": "no-store" } }
      )
    }
    const conversationId = params.get("conversationId") ?? ""
    const messageId = params.get("messageId") ?? ""
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
    const declaredSize = Number(request.headers.get("content-length"))
    if (declaredSize > ATTACHMENT_LIMITS.fileBytes)
      throw new AttachmentError(
        "file_too_large",
        "Files must be 5 MB or smaller.",
        413
      )
    validateAttachmentFile(name, 1)
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
    const bytes = Buffer.concat(chunks, size)
    const type = validateAttachmentFile(name, bytes.length)
    const row = await createAttachment({
      conversationId,
      messageId,
      slot: Number(params.get("slot") ?? -1),
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
    const safe = error instanceof AttachmentError || error instanceof DbError
    return Response.json(
      {
        error: safe
          ? error.message
          : "The attachment could not be saved or processed. Please try again.",
      },
      {
        status: safe ? error.status : 503,
        headers: { "Cache-Control": "no-store" },
      }
    )
  }
}

export const POST = handle
export const PATCH = handle
export const DELETE = handle
export const GET = handle
