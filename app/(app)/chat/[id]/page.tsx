import type { Metadata } from "next"

import { ChatWorkspace } from "@/components/chat-workspace"
import { mockConversations, mockMessages } from "@/lib/mock-chat"

export const metadata: Metadata = { title: "Conversation" }

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const conversation = mockConversations.find((item) => item.id === id)

  return (
    <ChatWorkspace
      initialMessages={mockMessages}
      title={conversation?.title ?? "Demo conversation"}
    />
  )
}
