"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  Code2Icon,
  FileSearchIcon,
  LightbulbIcon,
  MoreHorizontalIcon,
  PaletteIcon,
} from "lucide-react"

import { ChatComposer } from "@/components/chat-composer"
import { useConversations } from "@/components/app-shell"
import {
  listConversationsAction,
  saveDefaultModelAction,
  savePromptAction,
} from "@/app/(app)/chat/actions"
import { ChatMessage } from "@/components/chat-message"
import { AppSidebarTrigger } from "@/components/app-sidebar-trigger"
import { ModelPicker } from "@/components/model-picker"
import { Button } from "@/components/ui/button"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { MockAttachment, MockMessage } from "@/lib/mock-chat"
import { quickActions, sendMessage, type ChatInputMessage } from "@/lib/chat"
import type { Conversation } from "@/lib/db"
import { DEFAULT_MODEL_ID, getModel } from "@/lib/models"
import { waitForAttachments } from "@/lib/attachment-client"

type ChatStatus = "idle" | "thinking" | "streaming"

type ChatWorkspaceProps = {
  initialMessages?: MockMessage[]
  initialConversationId?: string
  initialModelId?: string
  title?: string
}

export function ChatWorkspace(props: ChatWorkspaceProps) {
  const pathname = usePathname()
  const [previousPath, setPreviousPath] = useState(pathname)
  const [newChatVersion, setNewChatVersion] = useState(0)
  // Native URL replacement keeps a first response mounted. Returning to /chat must reset it.
  if (previousPath !== pathname) {
    setPreviousPath(pathname)
    if (pathname === "/chat") setNewChatVersion(newChatVersion + 1)
  }
  return (
    <ChatSession
      key={`${props.initialConversationId ?? "new"}:${newChatVersion}`}
      {...props}
    />
  )
}

function ChatSession({
  initialMessages = [],
  initialConversationId,
  initialModelId = DEFAULT_MODEL_ID,
  title,
}: ChatWorkspaceProps) {
  const { conversations, setConversations } = useConversations()
  const [conversationId, setConversationId] = useState(initialConversationId)
  const [messages, setMessages] = useState<MockMessage[]>(initialMessages)
  const [value, setValue] = useState("")
  const [model, setModel] = useState(
    getModel(initialModelId) ? initialModelId : DEFAULT_MODEL_ID
  )
  const [status, setStatus] = useState<ChatStatus>("idle")
  const [attachments, setAttachments] = useState<MockAttachment[]>([])
  const [scrollToLatestRequest, setScrollToLatestRequest] = useState(0)
  const controllerRef = useRef<AbortController | null>(null)
  const hasConversation = messages.length > 0
  const [error, setError] = useState<string>()

  useEffect(
    () => () => {
      controllerRef.current?.abort()
      controllerRef.current = null
    },
    []
  )

  useEffect(() => {
    if (!initialConversationId) return
    const controller = new AbortController()
    for (const message of initialMessages) {
      const pending =
        message.attachments?.filter((item) => item.status === "processing") ??
        []
      if (!pending.length) continue
      void waitForAttachments(
        initialConversationId,
        message.id,
        pending.map((item) => item.id),
        controller.signal,
        (updated) => {
          setMessages((current) =>
            current.map((item) =>
              item.id === message.id
                ? {
                    ...item,
                    attachments: item.attachments?.map(
                      (attachment) =>
                        updated.find((next) => next.id === attachment.id) ??
                        attachment
                    ),
                  }
                : item
            )
          )
        }
      ).catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Attachment status could not be loaded."
          )
      })
    }
    return () => controller.abort()
  }, [initialConversationId, initialMessages])

  async function changeModel(modelId: string) {
    setModel(modelId)
    try {
      const result = await saveDefaultModelAction(modelId)
      if (result.error) setError(result.error)
    } catch {
      setError("Your model preference could not be saved. Please try again.")
    }
  }

  function updateAssistant(id: string, update: Partial<MockMessage>) {
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, ...update } : message
      )
    )
  }

  async function handleSubmit(retryMessage?: MockMessage) {
    const prompt = retryMessage?.content ?? value.trim()
    if (!prompt || status !== "idle" || controllerRef.current) return
    setError(undefined)

    const previousMessages = retryMessage
      ? messages.slice(
          0,
          messages.findIndex((message) => message.id === retryMessage.id)
        )
      : messages
    const history: ChatInputMessage[] = previousMessages
      .filter(
        (message) =>
          message.content.trim() &&
          message.status !== "failed" &&
          message.status !== "stopped" &&
          message.status !== "thinking"
      )
      .map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.role === "user" ? { id: message.id } : {}),
      }))
    history.push({ role: "user", content: prompt })
    let historySize = history.reduce(
      (size, message) => size + message.content.length,
      0
    )
    while (
      history.length > 1 &&
      (history.length > 100 || historySize > 100_000)
    ) {
      historySize -= history.shift()!.content.length
    }

    const sentAttachments = (
      retryMessage ? (retryMessage.attachments ?? []) : attachments
    ).map((attachment, slot) => ({
      ...attachment,
      slot: attachment.slot ?? slot,
    }))
    const userId = retryMessage?.id ?? `user-${Date.now()}`
    const assistantId = `assistant-${Date.now()}`
    const controller = new AbortController()
    controllerRef.current = controller
    setMessages(() => [
      ...previousMessages,
      {
        id: userId,
        role: "user",
        content: prompt,
        status: "complete",
        attachments: sentAttachments,
      },
      {
        id: assistantId,
        role: "assistant",
        content: "",
        status: "thinking",
        requestedModel: model,
      },
    ])
    setScrollToLatestRequest((current) => current + 1)
    if (!retryMessage) {
      setValue("")
      setAttachments([])
    }
    setStatus("thinking")

    let content = ""
    let persisted = !!retryMessage
    let savedMessageId = retryMessage?.id
    let savedConversationId = conversationId
    const currentAttachments: MockAttachment[] = sentAttachments
    const updateAttachments = () =>
      setMessages((current) =>
        current.map((message) =>
          message.id === savedMessageId || message.id === userId
            ? { ...message, attachments: [...currentAttachments] }
            : message
        )
      )
    try {
      if (!retryMessage) {
        const saved = await savePromptAction({
          conversationId,
          modelId: model,
          content: prompt,
        })
        if (!("conversation" in saved) || !("message" in saved))
          throw new Error(saved.error)
        persisted = true
        const savedConversation = saved.conversation as Conversation
        setConversations((current) =>
          [
            savedConversation,
            ...current.filter((item) => item.$id !== savedConversation.$id),
          ]
            .filter((item) => !item.isArchived)
            .slice(0, 100)
        )
        if (controllerRef.current !== controller) return
        setConversationId(savedConversation.$id)
        savedConversationId = savedConversation.$id
        savedMessageId = saved.message.$id
        setMessages((current) =>
          current.map((message) =>
            message.id === userId
              ? { ...message, id: saved.message.$id }
              : message
          )
        )
        if (!conversationId)
          window.history.replaceState(
            null,
            "",
            `/chat/${savedConversation.$id}`
          )
      }
      history[history.length - 1].id = savedMessageId
      controller.signal.throwIfAborted()
      for (let index = 0; index < currentAttachments.length; index++) {
        let attachment = currentAttachments[index]
        try {
          if (attachment.file) {
            currentAttachments[index] = { ...attachment, status: "uploading" }
            updateAttachments()
            const query = new URLSearchParams({
              conversationId: savedConversationId!,
              messageId: savedMessageId!,
              slot: String(attachment.slot),
              name: attachment.name,
            })
            const response = await fetch(`/api/attachments?${query}`, {
              method: "POST",
              body: attachment.file,
              signal: controller.signal,
            })
            const result = await response.json()
            if (!response.ok)
              throw new Error(
                result.error ?? "This file could not be uploaded."
              )
            attachment = { ...result.attachment, slot: attachment.slot }
            currentAttachments[index] = attachment
            updateAttachments()
          }
          if (attachment.status !== "ready" && !sentAttachments[index].file) {
            currentAttachments[index] = { ...attachment, status: "processing" }
            updateAttachments()
            const response = await fetch(
              `/api/attachments?id=${encodeURIComponent(attachment.id)}`,
              { method: "PATCH", signal: controller.signal }
            )
            const result = await response.json()
            if (!response.ok)
              throw new Error(
                result.error ?? "This file could not be processed."
              )
            currentAttachments[index] = {
              ...result.attachment,
              slot: attachment.slot,
            }
            updateAttachments()
          }
        } catch (error) {
          currentAttachments[index] = {
            ...currentAttachments[index],
            status: "error",
            error: controller.signal.aborted
              ? "Processing stopped. Retry this attachment."
              : error instanceof Error
                ? error.message
                : "This file could not be processed.",
          }
          updateAttachments()
          throw error
        }
      }
      if (
        currentAttachments.some((attachment) => attachment.status !== "ready")
      ) {
        await waitForAttachments(
          savedConversationId!,
          savedMessageId!,
          currentAttachments.map((item) => item.id),
          controller.signal,
          (updated) => {
            for (let index = 0; index < currentAttachments.length; index++) {
              const next = updated.find(
                (item) => item.id === currentAttachments[index].id
              )
              if (next)
                currentAttachments[index] = {
                  ...next,
                  slot: currentAttachments[index].slot,
                }
            }
            updateAttachments()
          }
        )
      }
      await sendMessage({
        model,
        messages: history,
        conversationId: savedConversationId!,
        messageId: savedMessageId!,
        signal: controller.signal,
        onMetadata: (metadata) => updateAssistant(assistantId, metadata),
        onStatus: (nextStatus) => {
          setStatus(nextStatus === "complete" ? "idle" : nextStatus)
          updateAssistant(assistantId, { status: nextStatus })
        },
        onChunk: (chunk) => {
          content += chunk
          updateAssistant(assistantId, { content, status: "streaming" })
        },
      })
    } catch (error) {
      if (!persisted) {
        setMessages((current) =>
          current.filter(
            (message) => message.id !== userId && message.id !== assistantId
          )
        )
        setValue(prompt)
        setAttachments(sentAttachments)
        setError(
          error instanceof Error
            ? error.message
            : "Your message could not be saved."
        )
      } else if (controller.signal.aborted) {
        updateAssistant(assistantId, {
          content: content.trim(),
          status: "stopped",
        })
      } else {
        updateAssistant(assistantId, {
          status: "failed",
          error:
            error instanceof Error
              ? error.message
              : "The response could not be generated. Try again.",
        })
      }
      setStatus("idle")
    } finally {
      controllerRef.current = null
      setStatus("idle")
      if (persisted) {
        try {
          const result = await listConversationsAction()
          if (result.conversations) setConversations(result.conversations)
          else if (result.error) setError(result.error)
        } catch {
          setError("Chat history could not be refreshed. Reload to try again.")
        }
      }
    }
  }

  function stopResponse() {
    controllerRef.current?.abort()
  }

  async function removeSavedAttachment(
    messageId: string,
    attachment: MockAttachment
  ) {
    if (status !== "idle" || controllerRef.current) return
    const controller = new AbortController()
    controllerRef.current = controller
    setStatus("thinking")
    try {
      // An ambiguous upload response may have committed: resolve the stable slot by retrying first.
      if (attachment.file && attachment.status === "error")
        throw new Error(
          "Retry the upload before removing it, or delete this conversation."
        )
      if (!attachment.file) {
        const response = await fetch(
          `/api/attachments?id=${encodeURIComponent(attachment.id)}`,
          { method: "DELETE", signal: controller.signal }
        )
        const result = await response.json()
        if (!response.ok && response.status !== 404)
          throw new Error(
            result.error ?? "This attachment could not be removed."
          )
      }
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                attachments: message.attachments?.filter(
                  (item) => item.id !== attachment.id
                ),
              }
            : message
        )
      )
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "This attachment could not be removed."
      )
    } finally {
      controllerRef.current = null
      setStatus("idle")
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-13 shrink-0 items-center gap-1.5 px-3 sm:px-4">
        <AppSidebarTrigger />
        <ModelPicker value={model} onValueChange={changeModel} />
        {(conversations.find((item) => item.$id === conversationId)?.title ||
          title) && (
          <span className="hidden truncate text-xs text-muted-foreground lg:block">
            /{" "}
            {conversations.find((item) => item.$id === conversationId)?.title ||
              title}
          </span>
        )}
        {hasConversation && (
          <div className="ml-auto">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Conversation options"
                  />
                }
              >
                <MoreHorizontalIcon />
              </TooltipTrigger>
              <TooltipContent>Conversation options</TooltipContent>
            </Tooltip>
          </div>
        )}
      </header>

      {error && (
        <p role="alert" className="px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {hasConversation ? (
        <ConversationView
          messages={messages}
          value={value}
          onValueChange={setValue}
          onSubmit={() => void handleSubmit()}
          onRetry={(message) => void handleSubmit(message)}
          onRemoveAttachment={removeSavedAttachment}
          onStop={stopResponse}
          scrollToLatestRequest={scrollToLatestRequest}
          status={status}
          model={model}
          onModelChange={changeModel}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
        />
      ) : (
        <EmptyChat
          value={value}
          onValueChange={setValue}
          onSubmit={() => void handleSubmit()}
          onStop={stopResponse}
          status={status}
          model={model}
          onModelChange={changeModel}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
        />
      )}
    </div>
  )
}

type ComposerStateProps = {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  onStop: () => void
  status: ChatStatus
  model: string
  onModelChange: (model: string) => void
  attachments: MockAttachment[]
  onAttachmentsChange: (attachments: MockAttachment[]) => void
}

function EmptyChat(props: ComposerStateProps) {
  const { conversations } = useConversations()
  const actionIcons = [PaletteIcon, FileSearchIcon, Code2Icon, LightbulbIcon]
  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-6">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center py-8 sm:py-12">
        <div className="mb-7 text-center sm:mb-8">
          <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-foreground sm:text-[30px]">
            What can I help with?
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Start a conversation or choose a prompt below.
          </p>
        </div>

        <ChatComposer {...props} />

        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {quickActions.map((action, index) => {
            const Icon = actionIcons[index]
            return (
              <button
                key={action.label}
                type="button"
                onClick={() => props.onValueChange(action.prompt)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground transition-colors outline-none hover:bg-white/[0.045] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <Icon className="size-3.5" /> {action.label}
              </button>
            )
          })}
        </div>

        {conversations.length > 0 && (
          <section
            className="mt-12 hidden sm:block"
            aria-labelledby="recent-chats-heading"
          >
            <div className="mb-2 flex items-center justify-between">
              <h2
                id="recent-chats-heading"
                className="text-xs font-medium text-muted-foreground"
              >
                Recent chats
              </h2>
            </div>
            <div className="grid grid-cols-3 divide-x divide-white/[0.06] border-y border-white/[0.06]">
              {conversations.slice(0, 3).map((conversation) => (
                <Link
                  key={conversation.$id}
                  href={`/chat/${conversation.$id}`}
                  prefetch={false}
                  className="min-w-0 px-3 py-3.5 transition-colors outline-none first:pl-0 last:pr-0 hover:bg-white/[0.025] focus-visible:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
                >
                  <p className="truncate text-[13px] text-foreground/90">
                    {conversation.title}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground/60">
                    {new Date(
                      conversation.lastMessageAt || conversation.$updatedAt
                    ).toLocaleDateString()}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

function ConversationView({
  messages,
  scrollToLatestRequest,
  ...composerProps
}: ComposerStateProps & {
  messages: MockMessage[]
  scrollToLatestRequest: number
  onRetry: (message: MockMessage) => void
  onRemoveAttachment: (messageId: string, attachment: MockAttachment) => void
}) {
  return (
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition="end"
      scrollEdgeThreshold={72}
    >
      <ConversationScrollView
        messages={messages}
        scrollToLatestRequest={scrollToLatestRequest}
        {...composerProps}
      />
    </MessageScrollerProvider>
  )
}

function ConversationScrollView({
  messages,
  scrollToLatestRequest,
  onRetry,
  onRemoveAttachment,
  ...composerProps
}: ComposerStateProps & {
  messages: MockMessage[]
  scrollToLatestRequest: number
  onRetry: (message: MockMessage) => void
  onRemoveAttachment: (messageId: string, attachment: MockAttachment) => void
}) {
  const { scrollToEnd } = useMessageScroller()

  useLayoutEffect(() => {
    if (scrollToLatestRequest === 0) return
    // Sending resumes live-edge following; typing and streamed chunks do not.
    scrollToEnd({ behavior: "auto" })
  }, [scrollToEnd, scrollToLatestRequest])

  return (
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <MessageScroller>
        <MessageScrollerViewport aria-label="Conversation messages">
          <MessageScrollerContent className="mx-auto w-full max-w-[48rem] min-w-0 gap-7 px-4 pt-8 pb-8 sm:px-6 sm:pt-12">
            {messages.map((message, index) => (
              <MessageScrollerItem key={message.id} messageId={message.id}>
                <ChatMessage
                  message={message}
                  attachmentActionsDisabled={composerProps.status !== "idle"}
                  onRemoveAttachment={(attachment) =>
                    onRemoveAttachment(message.id, attachment)
                  }
                  onRetry={
                    message.role === "user" &&
                    (index === messages.length - 1 ||
                      (index === messages.length - 2 &&
                        ["failed", "stopped"].includes(
                          messages[index + 1].status ?? ""
                        )))
                      ? () => onRetry(message)
                      : undefined
                  }
                />
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton className="bottom-3" />
      </MessageScroller>

      <div className="shrink-0 bg-[linear-gradient(to_top,var(--background)_76%,transparent)] px-3 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-5">
        <div className="mx-auto w-full max-w-[48rem]">
          <ChatComposer {...composerProps} compact />
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground/50">
            Zenote can make mistakes. Check important information.
          </p>
        </div>
      </div>
    </main>
  )
}
