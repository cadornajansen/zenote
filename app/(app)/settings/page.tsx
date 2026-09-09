import type { Metadata } from "next"

import { AppSidebarTrigger } from "@/components/app-sidebar-trigger"
import { ThemePreference } from "@/components/theme-preference"
import { getCurrentUser } from "@/lib/auth"

export const metadata: Metadata = { title: "Settings" }

export default async function SettingsPage() {
  const user = await getCurrentUser()

  return (
    <div className="h-full overflow-y-auto bg-background">
      <header className="flex h-13 items-center px-3 sm:px-4">
        <AppSidebarTrigger />
      </header>
      <section className="mx-auto max-w-3xl px-5 pt-8 pb-16 sm:px-8 sm:pt-12">
        <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
          Settings
        </h1>
        <div className="mt-10 border-t border-border/80 py-6">
          <p className="text-sm font-medium">Account</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {user?.name || "Zenote user"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{user?.email}</p>
        </div>
        <div className="border-t border-border/80 py-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Chat theme</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose the surface tone for this session.
              </p>
            </div>
            <ThemePreference />
          </div>
        </div>
      </section>
    </div>
  )
}
