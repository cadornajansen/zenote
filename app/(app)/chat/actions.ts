"use server"

import {
  createConversation,
  createMessage,
  DbError,
  deleteConversation,
  listConversations,
  updateConversation,
  updateUserPreferences,
} from "@/lib/db"

function safeError(error: unknown) {
  return error instanceof DbError
    ? error.message
    : "Your changes could not be saved. Please try again."
}

export async function savePromptAction(input: {
  conversationId?: string
  modelId: string
  content: string
}) {
  try {
    const saved = input.conversationId
      ? await createMessage(input.conversationId, {
          modelId: input.modelId,
          content: input.content,
          role: "user",
        })
      : await createConversation(input.content, input.modelId)
    return { ...saved, error: undefined }
  } catch (error) {
    return { error: safeError(error) }
  }
}

export async function listConversationsAction() {
  try {
    return { conversations: await listConversations(), error: undefined }
  } catch (error) {
    return { error: safeError(error) }
  }
}

export async function changeConversationAction(
  id: string,
  action: "rename" | "archive" | "unarchive" | "delete",
  title?: string
) {
  try {
    if (action === "delete") await deleteConversation(id)
    else if (action === "archive")
      await updateConversation(id, { isArchived: true })
    else if (action === "unarchive")
      await updateConversation(id, { isArchived: false })
    else if (action === "rename" && typeof title === "string")
      await updateConversation(id, { title })
    else throw new DbError("Invalid conversation action.")
    return { conversations: await listConversations(), error: undefined }
  } catch (error) {
    return { error: safeError(error) }
  }
}

export async function saveDefaultModelAction(modelId: string) {
  try {
    await updateUserPreferences({ defaultModelId: modelId })
    return { error: undefined }
  } catch (error) {
    return { error: safeError(error) }
  }
}
