import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AuthForm } from "@/components/auth-form"
import { AuthShell } from "@/components/auth-shell"
import { getCurrentUser } from "@/lib/auth"

export const metadata: Metadata = { title: "Create account" }

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/chat")

  return (
    <AuthShell title="Create your account" description="Start using Zenote with email or Google.">
      <AuthForm mode="signup" />
    </AuthShell>
  )
}
