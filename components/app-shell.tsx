"use client"

import { createContext, useContext, useEffect, useState } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { Conversation } from "@/lib/db"

const ConversationsContext = createContext<{
  conversations: Conversation[]
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>
} | null>(null)

export function useConversations() {
  const context = useContext(ConversationsContext)
  if (!context) throw new Error("Chat must be rendered within AppShell")
  return context
}

type AppShellProps = {
  user: { name: string; email: string }
  initialConversations: Conversation[]
  initialArchivedConversations: Conversation[]
  children: React.ReactNode
}

export function AppShell({
  user,
  children,
  initialConversations,
  initialArchivedConversations,
}: AppShellProps) {
  const [conversations, setConversations] = useState(initialConversations)
  useEffect(() => {
    document.body.classList.add("chat-theme")
    return () => {
      document.body.classList.remove("chat-theme")
      delete document.body.dataset.chatTone
    }
  }, [])

  return (
    <ConversationsContext value={{ conversations, setConversations }}>
      <TooltipProvider delay={350}>
        <SidebarProvider>
          <AppSidebar
            user={user}
            initialArchivedConversations={initialArchivedConversations}
          />
          <SidebarInset className="h-svh min-h-0 overflow-hidden">
            {children}
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </ConversationsContext>
  )
}
