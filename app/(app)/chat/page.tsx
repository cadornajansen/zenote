import type { Metadata } from "next"

import { ChatWorkspace } from "@/components/chat-workspace"
import { getUserPreferences } from "@/lib/db"
import { DEFAULT_MODEL_ID, getModel } from "@/lib/models"

export const metadata: Metadata = { title: "Chat" }

export default async function ChatPage() {
  const preferences = await getUserPreferences()
  const modelId = preferences?.defaultModelId
  return <ChatWorkspace initialModelId={modelId && getModel(modelId) ? modelId : DEFAULT_MODEL_ID} />
}
