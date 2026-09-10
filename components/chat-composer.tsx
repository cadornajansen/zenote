"use client"

import { useLayoutEffect, useRef, useState } from "react"
import {
  ArrowUpIcon,
  FileTextIcon,
  ImageIcon,
  MicIcon,
  PaperclipIcon,
  PlusIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"

import { ModelPicker } from "@/components/model-picker"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { MockAttachment } from "@/lib/mock-chat"
import { cn } from "@/lib/utils"

type ChatComposerProps = {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  onStop: () => void
  status: "idle" | "thinking" | "streaming"
  model: string
  onModelChange: (model: string) => void
  attachments: MockAttachment[]
  onAttachmentsChange: (attachments: MockAttachment[]) => void
  compact?: boolean
}

function attachmentIcon(type: MockAttachment["type"]) {
  if (type === "image") return ImageIcon
  if (type === "audio") return MicIcon
  return FileTextIcon
}

export function ChatComposer({
  value,
  onValueChange,
  onSubmit,
  onStop,
  status,
  model,
  onModelChange,
  attachments,
  onAttachmentsChange,
  compact = false,
}: ChatComposerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [dragging, setDragging] = useState(false)
  const active = status !== "idle"

  useLayoutEffect(() => {
    if (!textareaRef.current) return
    textareaRef.current.style.height = "0px"
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 192)}px`
  }, [value])

  function addFiles(files: FileList | File[]) {
    const next = Array.from(files).map((file, index): MockAttachment => ({
      id: `local-${file.name}-${file.lastModified}-${index}`,
      name: file.name,
      type: file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("audio/")
          ? "audio"
          : "document",
      size:
        file.size > 1_000_000
          ? `${(file.size / 1_000_000).toFixed(1)} MB`
          : `${Math.max(1, Math.round(file.size / 1000))} KB`,
      status: "ready",
    }))
    onAttachmentsChange([...attachments, ...next])
  }

  function removeAttachment(id: string) {
    onAttachmentsChange(
      attachments.filter((attachment) => attachment.id !== id)
    )
  }

  return (
    <div
      data-dragging={dragging || undefined}
      className={cn(
        "relative rounded-2xl bg-card shadow-sm ring-1 ring-border transition-[box-shadow,background-color] duration-200 focus-within:bg-secondary focus-within:ring-2 focus-within:ring-ring data-[dragging]:bg-accent data-[dragging]:ring-2 data-[dragging]:ring-ring",
        compact ? "p-2" : "p-2.5"
      )}
      onDragEnter={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        addFiles(event.dataTransfer.files)
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl bg-background/95 text-sm font-medium text-accent-foreground">
          Drop files to attach
        </div>
      )}

      {attachments.length > 0 && (
        <AttachmentGroup className="px-1 pb-1.5">
          {attachments.map((attachment) => {
            const Icon = attachmentIcon(attachment.type)
            const primitiveState =
              attachment.status === "ready"
                ? "done"
                : attachment.status === "attached"
                  ? "idle"
                  : attachment.status
            return (
              <Attachment
                key={attachment.id}
                state={primitiveState}
                size="sm"
                className="bg-secondary"
              >
                <AttachmentMedia>
                  {attachment.status === "processing" ? <Spinner /> : <Icon />}
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{attachment.name}</AttachmentTitle>
                  <AttachmentDescription>
                    {attachment.status === "error"
                      ? "Could not process"
                      : attachment.status === "processing"
                        ? "Processing..."
                        : attachment.size}
                  </AttachmentDescription>
                </AttachmentContent>
                <AttachmentActions>
                  <AttachmentAction
                    aria-label={`Remove ${attachment.name}`}
                    onClick={() => removeAttachment(attachment.id)}
                  >
                    <XIcon />
                  </AttachmentAction>
                </AttachmentActions>
              </Attachment>
            )
          })}
        </AttachmentGroup>
      )}

      {attachments.length > 0 && (
        <p role="status" className="px-2 pb-1 text-xs text-muted-foreground">
          Files are local previews only. Remove attachments to send a text
          message.
        </p>
      )}

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            if (!active && value.trim()) onSubmit()
          }
        }}
        placeholder="Ask Zenote anything..."
        aria-label="Message Zenote"
        rows={1}
        className={cn(
          "block max-h-48 w-full resize-none overflow-y-auto bg-transparent px-2 py-2 text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60",
          compact ? "min-h-12" : "min-h-24 sm:min-h-28"
        )}
      />

      <div className="flex items-center gap-1 pt-1">
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          onChange={(event) =>
            event.target.files && addFiles(event.target.files)
          }
        />
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Add attachment"
                    />
                  }
                />
              }
            >
              <PlusIcon />
            </TooltipTrigger>
            <TooltipContent>Add attachment</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" side="top" className="w-52">
            <DropdownMenuItem onClick={() => inputRef.current?.click()}>
              <PaperclipIcon /> Choose files
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex min-w-0 items-center gap-1">
          <ModelPicker value={model} onValueChange={onModelChange} compact />
          {active ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon"
                    variant="secondary"
                    aria-label="Stop generating"
                    onClick={onStop}
                  />
                }
              >
                <SquareIcon className="size-3 fill-current" />
              </TooltipTrigger>
              <TooltipContent>Stop generating</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon"
                    aria-label="Send message"
                    disabled={!value.trim()}
                    onClick={onSubmit}
                  />
                }
              >
                <ArrowUpIcon />
              </TooltipTrigger>
              <TooltipContent>Send message</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}
