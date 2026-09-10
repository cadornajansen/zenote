import "server-only"

import { AttachmentError } from "@/lib/attachment-policy"
import type { AttachmentKind } from "@/lib/attachment-policy"
import { listConversationAttachments } from "@/lib/db"

export type AttachmentContext = {
  messageId: string
  fileName: string
  kind: AttachmentKind
  text: string
}

export async function loadAttachmentContext(
  conversationId: string,
  messageIds: string[],
  currentMessageId: string,
  signal: AbortSignal
): Promise<AttachmentContext[]> {
  const rows = await listConversationAttachments(conversationId, messageIds)
  const context: AttachmentContext[] = []
  for (const row of rows) {
    signal.throwIfAborted()
    // Historical failures never trigger paid work or block a new prompt.
    if (row.messageId !== currentMessageId && row.status !== "ready") continue
    if (row.status === "uploaded" || row.status === "processing")
      throw new AttachmentError(
        "attachments_processing",
        "Attachments are still processing. Please wait before sending.",
        409
      )
    if (row.status === "failed" || !row.processedText)
      throw new AttachmentError(
        "attachment_failed",
        "An attachment could not be processed. Retry or remove it.",
        422
      )
    if (row.messageId)
      context.push({
        messageId: row.messageId,
        fileName: row.fileName,
        kind: row.kind,
        text: row.processedText,
      })
  }
  return context
}
