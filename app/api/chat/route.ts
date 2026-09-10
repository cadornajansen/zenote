import { getCurrentUser } from "@/lib/auth"
import {
  ChatError,
  recordChatTelemetry,
  safeChatError,
  streamChat,
  validateChatRequest,
  type ChatTelemetry,
} from "@/lib/ai"
import type { ChatEvent } from "@/lib/chat"
import { createMessage, DbError, getUserMessage } from "@/lib/db"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const started = Date.now()
  const telemetry: ChatTelemetry = {
    requestId: crypto.randomUUID(),
    latencyMs: 0,
    status: "error",
    rateLimits: {},
  }
  const controller = new AbortController()
  const signal = AbortSignal.any([
    request.signal,
    controller.signal,
    AbortSignal.timeout(180_000),
  ])
  const log = () => {
    telemetry.latencyMs = Date.now() - started
    recordChatTelemetry(telemetry)
  }
  try {
    if (!(await getCurrentUser()))
      throw new ChatError("Please sign in to continue chatting.", 401)
    const origin = request.headers.get("origin")
    if (origin && origin !== new URL(request.url).origin)
      throw new ChatError("Invalid request origin.", 403)
    if (!request.headers.get("content-type")?.includes("application/json"))
      throw new ChatError("Send a JSON chat request.", 415)
    // Bound the body before JSON parsing, including requests without Content-Length.
    const reader = request.body?.getReader()
    if (!reader) throw new ChatError("Invalid chat request.")
    let body = ""
    let bytes = 0
    const decoder = new TextDecoder()
    try {
      while (true) {
        signal.throwIfAborted()
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 512_000)
          throw new ChatError(
            "This conversation is too long. Start a new chat.",
            413
          )
        body += decoder.decode(value, { stream: true })
      }
      body += decoder.decode()
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      throw new ChatError("Invalid chat request.")
    }
    const input = validateChatRequest(parsed)
    const { conversationId, messageId } = parsed as Record<string, unknown>
    if (typeof conversationId !== "string" || typeof messageId !== "string")
      throw new ChatError("Save your message before generating a response.")
    try {
      const prompt = await getUserMessage(conversationId, messageId)
      const last = input.messages.at(-1)
      if (last?.role !== "user" || last.content !== prompt.content)
        throw new ChatError("The saved message does not match this request.")
    } catch (error) {
      if (error instanceof ChatError) throw error
      throw new ChatError(error instanceof DbError ? error.message : "The saved message could not be loaded.", error instanceof DbError ? error.status : 503)
    }
    telemetry.requestedModel = input.model
    const events = await streamChat(input, signal, telemetry)
    const encoder = new TextEncoder()
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      async start(output) {
        const emit = (event: ChatEvent) => {
          if (!cancelled)
            output.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }
        try {
          emit({ type: "metadata", requestId: telemetry.requestId })
          let content = ""
          for await (const event of events) {
            if (event.type === "delta") content += event.text
            emit(event)
          }
          signal.throwIfAborted()
          try {
            await createMessage(conversationId, { modelId: input.model, role: "assistant", content, parentMessageId: messageId }, signal)
          } catch {
            throw new ChatError("The response could not be saved. Your message is still in this chat.", 503)
          }
          telemetry.status = "complete"
          emit({ type: "done" })
        } catch (error) {
          telemetry.status =
            request.signal.aborted || cancelled ? "aborted" : "error"
          emit({ type: "error", message: safeChatError(error).message })
        } finally {
          controller.abort()
          log()
          if (!cancelled) output.close()
        }
      },
      cancel() {
        cancelled = true
        controller.abort()
      },
    })
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
        "X-Request-Id": telemetry.requestId,
      },
    })
  } catch (error) {
    controller.abort()
    if (request.signal.aborted) telemetry.status = "aborted"
    log()
    const safe = safeChatError(error)
    return Response.json(
      { error: safe.message, requestId: telemetry.requestId },
      {
        status: request.signal.aborted ? 499 : safe.status,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": telemetry.requestId,
        },
      }
    )
  }
}
