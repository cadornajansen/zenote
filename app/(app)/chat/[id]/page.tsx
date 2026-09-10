import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { ChatWorkspace } from "@/components/chat-workspace"
import {
  DbError,
  getConversation,
  listMessages,
  listConversationAttachments,
} from "@/lib/db"
import { attachmentSummary } from "@/lib/attachment-policy"
import type { MockMessage } from "@/lib/mock-chat"

export const metadata: Metadata = { title: "Conversation" }

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const conversation = await getConversation(id).catch((error) => {
    if (error instanceof DbError && error.status === 404) notFound()
    throw error
  })
  const messages = await listMessages(id)
  const attachments = await listConversationAttachments(
    id,
    messages
      .filter((message) => message.role === "user")
      .map((message) => message.$id)
  )
  const initialMessages: MockMessage[] = messages
    .filter(
      (message) => message.role === "user" || message.role === "assistant"
    )
    .map((message) => ({
      id: message.$id,
      role: message.role as "user" | "assistant",
      content: message.content,
      status: message.status === "completed" ? "complete" : "failed",
      attachments: attachments
        .filter((attachment) => attachment.messageId === message.$id)
        .map(attachmentSummary),
    }))

  return (
    <ChatWorkspace
      initialConversationId={conversation.$id}
      initialModelId={conversation.modelId}
      initialMessages={initialMessages}
      title={conversation.title}
    />
  )
}
