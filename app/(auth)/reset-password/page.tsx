import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AuthShell } from "@/components/auth-shell"
import { ResetPasswordForm } from "@/components/recovery-form"
import { getCurrentUser } from "@/lib/auth"

export const metadata: Metadata = { title: "Choose a new password" }

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ userId?: string; secret?: string }>
}) {
  if (await getCurrentUser()) redirect("/chat")
  const { userId = "", secret = "" } = await searchParams

  return (
    <AuthShell title="Choose a new password" description="Use at least 8 characters.">
      <ResetPasswordForm userId={userId} secret={secret} />
    </AuthShell>
  )
}
