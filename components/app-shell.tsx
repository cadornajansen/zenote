"use client"

import { useEffect } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

type AppShellProps = {
  user: { name: string; email: string }
  children: React.ReactNode
}

export function AppShell({ user, children }: AppShellProps) {
  useEffect(() => {
    document.body.classList.add("chat-theme")
    return () => {
      document.body.classList.remove("chat-theme")
      delete document.body.dataset.chatTone
    }
  }, [])

  return (
    <TooltipProvider delay={350}>
      <SidebarProvider>
        <AppSidebar user={user} />
        <SidebarInset className="h-svh min-h-0 overflow-hidden">
          {children}
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
