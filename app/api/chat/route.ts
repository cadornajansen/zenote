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
import { createMessage, DbError, getUserMessage, listMessages } from "@/lib/db"
import { loadAttachmentContext } from "@/lib/attachments"
import { AttachmentError } from "@/lib/attachment-policy"
import { admit, AdmissionError, releaseAdmission, type Admission } from "@/lib/admission"
import { isAppwriteId, isSameOriginRequest } from "@/lib/request-security"
import { InsufficientCreditsError, reserveChatCredits, settleChatCredits } from "@/lib/usage"
import { getModel, getModelByProviderId } from "@/lib/models"

export const runtime = "nodejs"

function actualZenoteModel(rawModel: string | undefined, requestedModel: string) {
  if (!rawModel) return requestedModel
  return getModel(rawModel)?.id ?? getModelByProviderId(rawModel)?.id ?? requestedModel
}

function retryablePersistenceError(error: unknown) {
  const code =
    error instanceof DbError
      ? error.status
      : typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "number"
        ? error.code
        : undefined
  return (
    code === 0 ||
    code === 408 ||
    code === 429 ||
    (typeof code === "number" && code >= 500) ||
    (error instanceof TypeError && error.message === "fetch failed")
  )
}

async function saveAssistantResponse(
  conversationId: string,
  input: Parameters<typeof createMessage>[1]
) {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await createMessage(conversationId, input)
    } catch (error) {
      lastError = error
      if (!retryablePersistenceError(error) || attempt === 2) throw error
      await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt))
    }
  }
  throw lastError
}

export async function POST(request: Request) {
  let admission: Admission | undefined
  let creditReservationId: string | undefined
  let creditContext: { userId: string; conversationId: string; messageId: string; requestedModel: string } | undefined
  const release = async () => {
    if (!admission) return
    const receipt = admission
    admission = undefined
    await releaseAdmission(receipt).catch(() => {})
  }
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
    const user = await getCurrentUser()
    if (!user)
      throw new ChatError("Please sign in to continue chatting.", 401)
    if (!isSameOriginRequest(request))
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
    if (!isAppwriteId(conversationId) || !isAppwriteId(messageId))
      throw new ChatError("Save your message before generating a response.")
    try {
      const prompt = await getUserMessage(conversationId, messageId)
      const last = input.messages.at(-1)
      if (last?.role !== "user" || last.content !== prompt.content)
        throw new ChatError("The saved message does not match this request.")
      if (
        input.messages.slice(0, -1).some((message) => message.id === messageId)
      )
        throw new ChatError("Duplicate message reference.")
      last.id = messageId
      const references = input.messages.filter(
        (message) => message.id && message.id !== messageId
      )
      if (references.length) {
        const history = await listMessages(conversationId)
        for (const reference of references) {
          if (
            !history.some(
              (message) =>
                message.$id === reference.id &&
                message.content === reference.content &&
                message.role === reference.role
            )
          )
            throw new ChatError(
              "The saved history does not match this request."
            )
        }
      }
    } catch (error) {
      if (error instanceof ChatError) throw error
      throw new ChatError(
        error instanceof DbError
          ? error.message
          : "The saved message could not be loaded.",
        error instanceof DbError ? error.status : 503
      )
    }
    telemetry.requestedModel = input.model
    const attachments = await loadAttachmentContext(
      conversationId,
      input.messages
        .filter((message) => message.role === "user" && message.id)
        .map((message) => message.id!),
      messageId,
      signal
    )
    signal.throwIfAborted()
    admission = await admit(user.$id, "chat_request")
    const reservation = await reserveChatCredits(user.$id, input.model, telemetry.requestId)
    creditReservationId = reservation.$id
    creditContext = { userId: user.$id, conversationId, messageId, requestedModel: input.model }
    const events = await streamChat(input, signal, telemetry, attachments)
    const encoder = new TextEncoder()
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      async start(output) {
        let completed = false
        let content = ""
        const emit = (event: ChatEvent) => {
          if (!cancelled)
            output.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }
        try {
          emit({ type: "metadata", requestId: telemetry.requestId })
          for await (const event of events) {
            if (event.type === "delta") content += event.text
            emit(event)
          }
          signal.throwIfAborted()
          try {
            await saveAssistantResponse(
              conversationId,
              {
                modelId: input.model,
                role: "assistant",
                content,
                parentMessageId: messageId,
              }
            )
          } catch {
            throw new ChatError(
              "The response could not be saved. Your message is still in this chat.",
              503
            )
          }
          telemetry.status = "complete"
          const actualModel = actualZenoteModel(telemetry.actualModel, input.model)
          await settleChatCredits({
            reservationId: creditReservationId!,
            actualModel,
            usage: {
              conversationId,
              messageId,
              requestedModel: input.model,
              provider: "assemblyai",
              fallbackUsed: actualModel !== input.model,
              inputTokens: telemetry.inputTokens,
              outputTokens: telemetry.outputTokens,
              cachedInputTokens: telemetry.cachedTokens,
              totalTokens: telemetry.inputTokens === undefined || telemetry.outputTokens === undefined ? undefined : telemetry.inputTokens + telemetry.outputTokens,
              latencyMs: Date.now() - started,
              status: "success",
              providerRequestId: telemetry.requestId,
            },
          })
          completed = true
          emit({ type: "done" })
        } catch (error) {
          telemetry.status =
            request.signal.aborted || cancelled ? "aborted" : "error"
          emit({ type: "error", message: safeChatError(error).message })
        } finally {
          if (creditReservationId && !completed) {
            const actualModel = actualZenoteModel(telemetry.actualModel, input.model)
            const materiallyStarted = content.trim().length > 0 ||
              (telemetry.outputTokens !== undefined && telemetry.outputTokens > 0)
            await settleChatCredits({
              reservationId: creditReservationId,
              actualModel,
              charge: materiallyStarted,
              usage: {
                conversationId,
                messageId,
                requestedModel: input.model,
                provider: "assemblyai",
                fallbackUsed: actualModel !== input.model,
                inputTokens: telemetry.inputTokens,
                outputTokens: telemetry.outputTokens,
                cachedInputTokens: telemetry.cachedTokens,
                totalTokens: telemetry.inputTokens === undefined || telemetry.outputTokens === undefined ? undefined : telemetry.inputTokens + telemetry.outputTokens,
                latencyMs: Date.now() - started,
                status: telemetry.status === "aborted" ? "aborted" : "failed",
                providerRequestId: telemetry.requestId,
                errorType: telemetry.status,
              },
            }).catch(() => {})
          }
          controller.abort()
          await release()
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
    if (creditReservationId && creditContext) {
      const actualModel = actualZenoteModel(telemetry.actualModel, creditContext.requestedModel)
      await settleChatCredits({
        reservationId: creditReservationId,
        actualModel,
        usage: {
          conversationId: creditContext.conversationId,
          messageId: creditContext.messageId,
          requestedModel: creditContext.requestedModel,
          provider: "assemblyai",
          fallbackUsed: actualModel !== creditContext.requestedModel,
          inputTokens: telemetry.inputTokens,
          outputTokens: telemetry.outputTokens,
          cachedInputTokens: telemetry.cachedTokens,
          latencyMs: Date.now() - started,
          status: request.signal.aborted ? "aborted" : "failed",
          providerRequestId: telemetry.requestId,
          errorType: "before_stream",
        },
      }).catch(() => {})
    }
    await release()
    if (request.signal.aborted) telemetry.status = "aborted"
    log()
    const safe = error instanceof AttachmentError || error instanceof AdmissionError || error instanceof InsufficientCreditsError ? error : safeChatError(error)
    return Response.json(
      {
        error: safe.message,
        ...(error instanceof AttachmentError || error instanceof AdmissionError || error instanceof InsufficientCreditsError ? { code: error.code } : {}),
        ...(error instanceof InsufficientCreditsError ? { requiredCredits: error.requiredCredits, availableCredits: error.availableCredits, modelId: error.modelId } : {}),
        ...(error instanceof AdmissionError && error.retryAfter ? { retryAfter: error.retryAfter } : {}),
        requestId: telemetry.requestId,
      },
      {
        status: request.signal.aborted ? 499 : safe.status,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": telemetry.requestId,
          ...(error instanceof AdmissionError && error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}),
        },
      }
    )
  }
}
