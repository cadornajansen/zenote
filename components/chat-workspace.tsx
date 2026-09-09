"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import {
  Code2Icon,
  FileSearchIcon,
  LightbulbIcon,
  MoreHorizontalIcon,
  PaletteIcon,
} from "lucide-react"

import { ChatComposer } from "@/components/chat-composer"
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
} from "@/components/ui/message-scroller"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  mockConversations,
  quickActions,
  type MockAttachment,
  type MockMessage,
} from "@/lib/mock-chat"
import { sendMessage, type ChatInputMessage } from "@/lib/chat"
import { DEFAULT_MODEL_ID } from "@/lib/models"

type ChatStatus = "idle" | "thinking" | "streaming"

export function ChatWorkspace({
  initialMessages = [],
  title,
}: {
  initialMessages?: MockMessage[]
  title?: string
}) {
  const [messages, setMessages] = useState<MockMessage[]>(initialMessages)
  const [value, setValue] = useState("")
  const [model, setModel] = useState(DEFAULT_MODEL_ID)
  const [status, setStatus] = useState<ChatStatus>("idle")
  const [attachments, setAttachments] = useState<MockAttachment[]>([])
  const controllerRef = useRef<AbortController | null>(null)
  const hasConversation = messages.length > 0
  const [error, setError] = useState<string>()

  useEffect(() => () => controllerRef.current?.abort(), [])

  function updateAssistant(id: string, update: Partial<MockMessage>) {
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? { ...message, ...update } : message
      )
    )
  }

  async function handleSubmit() {
    const prompt = value.trim()
    if (!prompt || status !== "idle" || controllerRef.current) return
    if (attachments.length) {
      setError(
        "Attachments are not supported yet. Remove them and send text only."
      )
      return
    }
    setError(undefined)

    const history: ChatInputMessage[] = messages
      .filter(
        (message) =>
          message.content.trim() &&
          message.status !== "failed" &&
          message.status !== "thinking"
      )
      .map((message) => ({ role: message.role, content: message.content }))
    history.push({ role: "user", content: prompt })

    const sentAttachments = attachments
    const userId = `user-${Date.now()}`
    const assistantId = `assistant-${Date.now()}`
    const controller = new AbortController()
    controllerRef.current = controller
    setMessages((current) => [
      ...current,
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
    setValue("")
    setAttachments([])
    setStatus("thinking")

    let content = ""
    try {
      await sendMessage({
        model,
        messages: history,
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
      if (controller.signal.aborted) {
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
    }
  }

  function stopResponse() {
    controllerRef.current?.abort()
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-13 shrink-0 items-center gap-1.5 px-3 sm:px-4">
        <AppSidebarTrigger />
        <ModelPicker value={model} onValueChange={setModel} />
        {title && (
          <span className="hidden truncate text-xs text-muted-foreground lg:block">
            / {title}
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
          onSubmit={handleSubmit}
          onStop={stopResponse}
          status={status}
          model={model}
          onModelChange={setModel}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
        />
      ) : (
        <EmptyChat
          value={value}
          onValueChange={setValue}
          onSubmit={handleSubmit}
          onStop={stopResponse}
          status={status}
          model={model}
          onModelChange={setModel}
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
            <span className="text-[11px] text-muted-foreground/55">
              Mock data
            </span>
          </div>
          <div className="grid grid-cols-3 divide-x divide-white/[0.06] border-y border-white/[0.06]">
            {mockConversations.slice(0, 3).map((conversation) => (
              <Link
                key={conversation.id}
                href={`/chat/${conversation.id}`}
                className="min-w-0 px-3 py-3.5 transition-colors outline-none first:pl-0 last:pr-0 hover:bg-white/[0.025] focus-visible:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <p className="truncate text-[13px] text-foreground/90">
                  {conversation.title}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground/60">
                  {conversation.updatedAt}
                </p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

function ConversationView({
  messages,
  ...composerProps
}: ComposerStateProps & { messages: MockMessage[] }) {
  return (
    <MessageScrollerProvider
      autoScroll
      defaultScrollPosition="end"
      scrollEdgeThreshold={72}
    >
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <MessageScroller>
          <MessageScrollerViewport aria-label="Conversation messages">
            <MessageScrollerContent className="mx-auto w-full min-w-0 max-w-[48rem] gap-7 px-4 pt-8 pb-8 sm:px-6 sm:pt-12">
              {messages.map((message, index) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={index === messages.length - 1}
                >
                  <ChatMessage message={message} />
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
    </MessageScrollerProvider>
  )
}
