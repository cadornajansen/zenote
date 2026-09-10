export type ChatInputMessage = {
  role: "user" | "assistant"
  content: string
  id?: string
}

export const quickActions = [
  { label: "Create", prompt: "Create a concise outline for " },
  {
    label: "Analyze image",
    prompt: "Analyze this image and highlight the important details.",
  },
  { label: "Help me code", prompt: "Help me debug this code: " },
  {
    label: "Explain",
    prompt: "Explain this clearly with a practical example: ",
  },
]

export type ChatRequest = { model: string; messages: ChatInputMessage[] }
export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "metadata"; requestId: string; actualModel?: string }
  | { type: "error"; message: string }
  | { type: "done" }

// Shared SSE framing only. Provider payload interpretation stays server-side.
export async function* readSseData(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let data: string[] = []
  let eventSize = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true })
      if (buffer.length > 1_000_000) throw new Error("Stream frame too large")
      let end: number
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end).replace(/\r$/, "")
        buffer = buffer.slice(end + 1)
        if (line === "") {
          if (data.length) yield data.join("\n")
          data = []
          eventSize = 0
        } else if (line.startsWith("data:")) {
          eventSize += line.length
          if (eventSize > 1_000_000) throw new Error("Stream frame too large")
          data.push(line.slice(5).replace(/^ /, ""))
        }
      }
      if (done) break
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export async function sendMessage({
  model,
  messages,
  conversationId,
  messageId,
  signal,
  onStatus,
  onChunk,
  onMetadata,
}: ChatRequest & {
  conversationId: string
  messageId: string
  signal: AbortSignal
  onStatus: (status: "thinking" | "streaming" | "complete") => void
  onChunk: (chunk: string) => void
  onMetadata: (metadata: { requestId: string; actualModel?: string }) => void
}) {
  onStatus("thinking")
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, conversationId, messageId }),
    signal,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(
      error?.error ?? "The response could not be generated. Try again."
    )
  }
  if (!response.body)
    throw new Error("The response stream is unavailable. Try again.")
  for await (const data of readSseData(response.body)) {
    signal.throwIfAborted()
    const event: ChatEvent = JSON.parse(data)
    if (event.type === "error") throw new Error(event.message)
    if (event.type === "metadata") onMetadata(event)
    if (event.type === "delta") {
      onStatus("streaming")
      onChunk(event.text)
    }
    if (event.type === "done") {
      onStatus("complete")
      return
    }
  }
  throw new Error("The response was interrupted. Please try again.")
}
