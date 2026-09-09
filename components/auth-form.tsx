"use client"

import Link from "next/link"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"

import {
  type AuthActionState,
  signInAction,
  signUpAction,
  startGoogleAction,
} from "@/app/(auth)/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

type AuthFormProps = {
  mode: "login" | "signup"
  notice?: string
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.55h3.24c1.9-1.75 2.98-4.32 2.98-7.42"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.98-.9 6.63-2.35l-3.24-2.55c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.63A10 10 0 0 0 12 22"
      />
      <path
        fill="#FBBC05"
        d="M6.39 13.93A6 6 0 0 1 6.07 12c0-.67.12-1.32.32-1.93V7.44H3.04A10 10 0 0 0 2 12c0 1.64.39 3.2 1.04 4.56z"
      />
      <path
        fill="#EA4335"
        d="M12 5.94c1.47 0 2.79.5 3.82 1.5l2.88-2.88A9.7 9.7 0 0 0 12 2a10 10 0 0 0-8.96 5.44l3.35 2.63C7.18 7.7 9.39 5.94 12 5.94"
      />
    </svg>
  )
}

function SubmitButton({ idle, pending }: { idle: string; pending: string }) {
  const status = useFormStatus()
  return (
    <Button type="submit" className="h-10 w-full" disabled={status.pending}>
      {status.pending ? pending : idle}
    </Button>
  )
}

function GoogleButton() {
  const status = useFormStatus()
  return (
    <Button
      type="submit"
      variant="outline"
      className="h-10 w-full rounded-lg bg-transparent"
      disabled={status.pending}
    >
      <GoogleIcon />
      {status.pending ? "Redirecting…" : "Continue with Google"}
    </Button>
  )
}

export function AuthForm({ mode, notice }: AuthFormProps) {
  const action = mode === "login" ? signInAction : signUpAction
  const [state, formAction] = useActionState<AuthActionState, FormData>(
    action,
    {}
  )

  return (
    <div>
      {notice && (
        <p className="mb-5 rounded-lg border border-primary/25 bg-primary/8 px-3 py-2 text-sm text-accent-foreground">
          {notice}
        </p>
      )}
      <form action={startGoogleAction}>
        <GoogleButton />
      </form>

      <div className="my-4 flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">or</span>
        <Separator className="flex-1" />
      </div>

      <form action={formAction} className="space-y-3.5">
        {mode === "signup" && (
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              placeholder="Your name"
              required
              className="auth-input h-10"
            />
          </div>
        )}
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
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="password">Password</Label>
            {mode === "login" && (
              <Link
                href="/forgot-password"
                className="text-xs text-primary hover:underline"
              >
                Forgot password?
              </Link>
            )}
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            minLength={8}
            maxLength={256}
            placeholder={
              mode === "login" ? "Your password" : "At least 8 characters"
            }
            required
            className="auth-input h-10"
          />
        </div>

        {state.error && (
          <p role="alert" className="text-sm leading-6 text-destructive">
            {state.error}
          </p>
        )}

        <SubmitButton
          idle={mode === "login" ? "Sign in" : "Create account"}
          pending={mode === "login" ? "Signing in…" : "Creating account…"}
        />
      </form>

      <p className="mt-5 text-center text-sm text-muted-foreground">
        {mode === "login"
          ? "Don’t have an account?"
          : "Already have an account?"}{" "}
        <Link
          href={mode === "login" ? "/signup" : "/login"}
          className="font-medium text-foreground hover:underline"
        >
          {mode === "login" ? "Sign up" : "Sign in"}
        </Link>
      </p>
    </div>
  )
}
