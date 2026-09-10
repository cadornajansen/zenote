import { redirect } from "next/navigation"

import { AppShell } from "@/components/app-shell"
import { getCurrentUser } from "@/lib/auth"
import {
  ensureUser,
  listArchivedConversations,
  listConversations,
} from "@/lib/db"

export default async function ProtectedAppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  await ensureUser()
  const [conversations, archivedConversations] = await Promise.all([
    listConversations(),
    listArchivedConversations(),
  ])

  return (
    <AppShell
      user={user}
      initialConversations={conversations}
      initialArchivedConversations={archivedConversations}
    >
      {children}
    </AppShell>
  )
}
