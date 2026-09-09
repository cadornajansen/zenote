"use client"

import type { ComponentProps } from "react"

import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar"

export function AppSidebarTrigger(
  props: ComponentProps<typeof SidebarTrigger>
) {
  const { isMobile, state } = useSidebar()

  if (!isMobile && state === "expanded") return null

  return <SidebarTrigger {...props} />
}
