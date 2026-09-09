"use client"

import Link from "next/link"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"

import {
  type AuthActionState,
  forgotPasswordAction,
  resetPasswordAction,
} from "@/app/(auth)/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

function RecoverySubmit({ idle, pending }: { idle: string; pending: string }) {
  const status = useFormStatus()
  return (
    <Button type="submit" className="h-10 w-full" disabled={status.pending}>
      {status.pending ? pending : idle}
    </Button>
  )
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState<AuthActionState, FormData>(
    forgotPasswordAction,
    {}
  )

  return (
    <form action={action} className="space-y-3.5">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          className="auth-input h-10"
        />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-sm leading-6 text-accent-foreground">
          {state.success}
        </p>
      )}
      <RecoverySubmit idle="Send reset link" pending="Sending…" />
      <Link
        href="/login"
        className="block text-center text-sm text-muted-foreground hover:text-foreground"
      >
        Back to sign in
      </Link>
    </form>
  )
}

export function ResetPasswordForm({
  userId,
  secret,
}: {
  userId: string
  secret: string
}) {
  const [state, action] = useActionState<AuthActionState, FormData>(
    resetPasswordAction,
    {}
  )

  return (
    <form action={action} className="space-y-3.5">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="secret" value={secret} />
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={256}
          placeholder="At least 8 characters"
          required
          className="auth-input h-10"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={256}
          placeholder="Repeat your password"
          required
          className="auth-input h-10"
        />
      </div>
      {state.error && (
        <p role="alert" className="text-sm leading-6 text-destructive">
          {state.error}
        </p>
      )}
      <RecoverySubmit idle="Set new password" pending="Updating…" />
    </form>
  )
}
