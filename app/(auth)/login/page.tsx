import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AuthForm } from "@/components/auth-form"
import { AuthShell } from "@/components/auth-shell"
import { getCurrentUser } from "@/lib/auth"

export const metadata: Metadata = { title: "Sign in" }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>
}) {
  if (await getCurrentUser()) redirect("/chat")
  const params = await searchParams
  const notice =
    params.error === "oauth"
      ? "Google sign-in was cancelled or could not be completed."
      : params.reset === "success"
        ? "Your password has been updated. You can sign in now."
        : undefined

  return (
    <AuthShell title="Welcome back" description="Sign in to continue to Zenote.">
      <AuthForm mode="login" notice={notice} />
    </AuthShell>
  )
}
