"use client"

import { memo, useEffect, useRef, useState } from "react"
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileTextIcon,
  MoreHorizontalIcon,
  RefreshCcwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react"

import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { AiResponse } from "@/components/ai-response"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Message, MessageContent, MessageFooter } from "@/components/ui/message"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { MockMessage, MockMessageBlock } from "@/lib/mock-chat"

export const ChatMessage = memo(function ChatMessage({ message }: { message: MockMessage }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const isUser = message.role === "user"

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message.blocks?.map(blockMarkdown).join("\n\n") ?? message.content)
      setCopied(true)
      setCopyError(false)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopyError(true)
    }
  }

  if (isUser) {
    return (
      <Message align="end" className="group py-1">
        <MessageContent className="items-end">
          {message.attachments?.map((attachment) => (
            <Attachment
              key={attachment.id}
              size="sm"
              state={attachment.status === "error" ? "error" : "done"}
            >
              <AttachmentMedia>
                <FileTextIcon />
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{attachment.name}</AttachmentTitle>
                <AttachmentDescription>{attachment.size}</AttachmentDescription>
              </AttachmentContent>
            </Attachment>
          ))}
          <Bubble
            variant="secondary"
            align="end"
            className="max-w-[88%] sm:max-w-[78%]"
          >
            <BubbleContent className="border-0 bg-secondary px-3.5 py-2.5 text-[15px] leading-6 text-foreground">
              {message.content}
            </BubbleContent>
          </Bubble>
          <MessageActions onCopy={copyMessage} copied={copied} user />
          {copyError && <p role="status" className="text-xs text-muted-foreground">Copy failed. Please try again.</p>}
        </MessageContent>
      </Message>
    )
  }

  return (
    <Message className="group py-1">
      <MessageContent>
        {message.status === "thinking" ? (
          <div
            className="flex items-center gap-2 py-2 text-sm text-muted-foreground"
            role="status"
          >
            <Spinner className="size-3.5 text-primary" />
            Thinking...
          </div>
        ) : (
          <>
            {message.thoughtSeconds && (
              <Collapsible>
                <CollapsibleTrigger className="group/thought flex items-center gap-1 py-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
                  Thought for {message.thoughtSeconds}s
                  <ChevronDownIcon className="size-3 transition-transform group-data-[panel-open]/thought:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pb-2 text-xs leading-5 text-muted-foreground">
                  Compared the two cache lifetimes and selected a practical
                  example.
                </CollapsibleContent>
              </Collapsible>
            )}
            <div className="chat-prose w-full min-w-0 max-w-full text-[15px] leading-7 text-foreground/95">
              {message.blocks ? (
                message.blocks.map((block, index) => (
                  <MessageBlock key={`${block.type}-${index}`} block={block} />
                ))
              ) : (
                <AiResponse content={message.content} streaming={message.status === "streaming"} />
              )}
              {message.status === "streaming" && (
                <span
                  className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-primary align-middle"
                  aria-hidden="true"
                />
              )}
              {message.status === "stopped" && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Generation stopped
                </p>
              )}
              {message.status === "failed" && (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  {message.error ??
                    "The response could not be generated. Try again."}
                </p>
              )}
            </div>
            {message.status !== "streaming" && (
              <MessageActions onCopy={copyMessage} copied={copied} />
            )}
            {copyError && <p role="status" className="text-xs text-muted-foreground">Copy failed. Please try again.</p>}
          </>
        )}
      </MessageContent>
    </Message>
  )
})

function blockMarkdown(block: MockMessageBlock): string {
  switch (block.type) {
    case "paragraph": return block.text
    case "heading": return `## ${block.text}`
    case "list": return block.items.map((item) => `- ${item}`).join("\n")
    case "code": {
      const fence = "`".repeat(Math.max(3, ...Array.from(block.code.matchAll(/`+/g), (match) => match[0].length + 1)))
      return `${fence}${block.language}\n${block.code}\n${fence}`
    }
    case "table": {
      const row = (cells: string[]) => `| ${cells.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`
      return [row(block.headers), row(block.headers.map(() => "---")), ...block.rows.map(row)].join("\n")
    }
    case "image": return `${block.label}. ${block.description}`
    case "sources": return block.items.map((source) => `[${source.label}](${source.href})`).join("\n")
  }
}

function MessageBlock({ block }: { block: MockMessageBlock }) {
  if (block.type !== "image" && block.type !== "sources")
    return <AiResponse content={blockMarkdown(block)} />
  if (block.type === "image") {
    return (
      <figure className="my-5 overflow-hidden rounded-xl bg-card ring-1 ring-border">
        <div className="relative flex aspect-[16/7] items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_25%_45%,rgba(180,180,180,.1),transparent_22%),linear-gradient(135deg,#171717,#090909)]">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="rounded-md bg-white/[0.05] px-3 py-2">
              Request
            </span>
            <span className="h-px w-10 bg-primary/50" />
            <span className="rounded-md bg-primary/10 px-3 py-2 text-accent-foreground">
              Cache
            </span>
            <span className="h-px w-10 bg-white/15" />
            <span className="rounded-md bg-white/[0.05] px-3 py-2">Render</span>
          </div>
        </div>
        <figcaption className="border-t border-white/[0.06] px-3 py-2.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{block.label}.</span>{" "}
          {block.description}
        </figcaption>
      </figure>
    )
  }
  return (
    <div className="mt-6 border-t border-white/[0.07] pt-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">Sources</p>
      <div className="flex flex-wrap gap-2">
        {block.items.map((source, index) => (
          <a
            key={source.href}
            href={source.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.04] px-2.5 py-1.5 text-xs text-muted-foreground outline-none hover:bg-white/[0.07] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span className="text-primary">{index + 1}</span> {source.label}
            <ExternalLinkIcon className="size-3" />
          </a>
        ))}
      </div>
    </div>
  )
}

function MessageActions({
  onCopy,
  copied,
  user = false,
}: {
  onCopy: () => void
  copied: boolean
  user?: boolean
}) {
  const actions = [
    { label: "Copy", icon: copied ? CheckIcon : CopyIcon, action: onCopy },
    ...(!user
      ? [
          { label: "Retry", icon: RefreshCcwIcon },
          { label: "Like", icon: ThumbsUpIcon },
          { label: "Dislike", icon: ThumbsDownIcon },
          { label: "More", icon: MoreHorizontalIcon },
        ]
      : []),
  ]
  return (
    <MessageFooter className="mt-1 -ml-1 gap-0 px-0 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
      {actions.map(({ label, icon: Icon, action }) => (
        <Tooltip key={label}>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={label}
                onClick={action}
              />
            }
          >
            <Icon />
          </TooltipTrigger>
          <TooltipContent>
            {copied && label === "Copy" ? "Copied" : label}
          </TooltipContent>
        </Tooltip>
      ))}
    </MessageFooter>
  )
}
