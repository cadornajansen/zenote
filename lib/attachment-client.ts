import type { AttachmentSummary } from "@/lib/attachment-policy"

export async function waitForAttachments(
  conversationId: string,
  messageId: string,
  ids: string[],
  signal: AbortSignal,
  onUpdate: (attachments: AttachmentSummary[]) => void
) {
  const query = new URLSearchParams({ conversationId, messageId })
  const deadline = Date.now() + 420_000
  const timeout = AbortSignal.timeout(420_000)
  const pollingSignal = AbortSignal.any([signal, timeout])
  const timeoutMessage =
    "Attachments are taking longer than expected. Retry to check their status."
  let interval = 800
  try {
    for (;;) {
      pollingSignal.throwIfAborted()
      const response = await fetch(`/api/attachments?${query}`, {
        signal: pollingSignal,
        cache: "no-store",
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(
          result.error ?? "Attachment status could not be loaded."
        )
      const current = (result.attachments as AttachmentSummary[]).filter(
        (item) => ids.includes(item.id)
      )
      onUpdate(current)
      if (current.length !== ids.length)
        throw new Error("An attachment was removed. Retry your message.")
      const failed = current.find(
        (item) => item.status === "error" || item.status === "attached"
      )
      if (failed)
        throw new Error(
          failed.error ?? "Attachment processing was not queued. Please retry."
        )
      if (current.every((item) => item.status === "ready")) return
      if (Date.now() >= deadline) throw new Error(timeoutMessage)
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer)
          reject(pollingSignal.reason)
        }
        const timer = setTimeout(() => {
          pollingSignal.removeEventListener("abort", abort)
          resolve()
        }, interval)
        pollingSignal.addEventListener("abort", abort, { once: true })
        if (pollingSignal.aborted) abort()
      })
      interval = Math.min(3000, Math.round(interval * 1.3))
    }
  } catch (error) {
    if (timeout.aborted && !signal.aborted) throw new Error(timeoutMessage)
    throw error
  }
}
