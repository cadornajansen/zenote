"use client"

import { useState, type Dispatch, type SetStateAction } from "react"
import { ArchiveRestoreIcon, MessageSquareIcon, Trash2Icon } from "lucide-react"

import { changeConversationAction } from "@/app/(app)/chat/actions"
import { useConversations } from "@/components/app-shell"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import type { Conversation } from "@/lib/db"

type ArchivedChatsProps = {
  conversations: Conversation[]
  onConversationsChange: Dispatch<SetStateAction<Conversation[]>>
}

function conversationDate(conversation: Conversation) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(conversation.lastMessageAt || conversation.$updatedAt))
}

export function ArchivedChats({
  conversations: archivedConversations,
  onConversationsChange,
}: ArchivedChatsProps) {
  const { setConversations } = useConversations()
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null)
  const [mutatingId, setMutatingId] = useState<string>()
  const [error, setError] = useState<string>()

  async function changeArchivedConversation(
    conversation: Conversation,
    action: "unarchive" | "delete"
  ) {
    setError(undefined)
    setMutatingId(conversation.$id)

    try {
      const result = await changeConversationAction(conversation.$id, action)
      if (result.error) {
        setError(result.error)
        return
      }

      setConversations(result.conversations!)
      onConversationsChange((current) =>
        current.filter((item) => item.$id !== conversation.$id)
      )
      setPendingDelete(null)
    } catch {
      setError("Your changes could not be saved. Please try again.")
    } finally {
      setMutatingId(undefined)
    }
  }

  return (
    <section
      aria-labelledby="archived-chats-heading"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="archived-chats-heading" className="text-sm font-medium">
          Archived chats
        </h2>
        <p className="text-sm text-muted-foreground">
          Hidden from your sidebar, but kept until you delete them.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {archivedConversations.length === 0 ? (
        <Empty className="min-h-40 border border-border/70">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ArchiveRestoreIcon />
            </EmptyMedia>
            <EmptyTitle>No archived chats</EmptyTitle>
            <EmptyDescription>
              Chats you archive will appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="divide-y divide-border/70 border-y border-border/70">
          {archivedConversations.map((conversation) => {
            const isMutating = mutatingId === conversation.$id

            return (
              <div
                key={conversation.$id}
                className="flex min-w-0 items-center gap-3 py-3"
              >
                <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {conversation.title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {conversationDate(conversation)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={isMutating}
                    onClick={() =>
                      void changeArchivedConversation(conversation, "unarchive")
                    }
                  >
                    <ArchiveRestoreIcon data-icon="inline-start" />
                    {isMutating ? "Restoring..." : "Restore"}
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={isMutating}
                    aria-label={`Delete ${conversation.title}`}
                    onClick={() => {
                      setError(undefined)
                      setPendingDelete(conversation)
                    }}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open && !mutatingId) setPendingDelete(null)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this archived chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the conversation and its messages. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(mutatingId)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={Boolean(mutatingId)}
              onClick={() => {
                if (pendingDelete)
                  void changeArchivedConversation(pendingDelete, "delete")
              }}
            >
              {mutatingId ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
