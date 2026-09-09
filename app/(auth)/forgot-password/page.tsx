import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AuthShell } from "@/components/auth-shell"
import { ForgotPasswordForm } from "@/components/recovery-form"
import { getCurrentUser } from "@/lib/auth"

export const metadata: Metadata = { title: "Reset your password" }

export default async function ForgotPasswordPage() {
  if (await getCurrentUser()) redirect("/chat")

  return (
    <AuthShell title="Reset your password" description="We’ll email you a secure reset link.">
      <ForgotPasswordForm />
    </AuthShell>
  )
}
