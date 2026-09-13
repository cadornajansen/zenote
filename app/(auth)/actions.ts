"use server"

import { AppwriteException } from "node-appwrite"
import { redirect } from "next/navigation"

import {
  getAuthErrorMessage,
  isValidAuthTokenInput,
  resetPassword,
  signInWithEmail,
  signInWithGoogle,
  signOut,
  signUpWithEmail,
  startPasswordRecovery,
} from "@/lib/auth"

export type AuthActionState = {
  error?: string
  success?: string
}

function field(formData: FormData, name: string) {
  const value = formData.get(name)
  return typeof value === "string" ? value.trim() : ""
}

function validateEmail(email: string) {
  return email.length <= 254 && /^\S+@\S+\.\S+$/.test(email)
}

function validatePassword(password: string) {
  return password.length >= 8 && password.length <= 256
}

export async function signInAction(
  _state: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const email = field(formData, "email")
  const password = field(formData, "password")

  if (!validateEmail(email) || !password) {
    return { error: "Enter a valid email and password." }
  }

  try {
    await signInWithEmail(email, password)
  } catch (error) {
    return { error: getAuthErrorMessage(error) }
  }

  redirect("/chat")
}

export async function signUpAction(
  _state: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const name = field(formData, "name")
  const email = field(formData, "email")
  const password = field(formData, "password")

  if (!name || name.length > 128) return { error: "Enter your name." }
  if (!validateEmail(email)) return { error: "Enter a valid email address." }
  if (!validatePassword(password)) {
    return { error: "Password must contain at least 8 characters." }
  }

  try {
    await signUpWithEmail(name, email, password)
  } catch (error) {
    return { error: getAuthErrorMessage(error) }
  }

  redirect("/chat")
}

export async function startGoogleAction(_formData: FormData) {
  void _formData
  let authorizationUrl: string

  try {
    authorizationUrl = await signInWithGoogle()
  } catch (error) {
    console.error("Google OAuth initiation failed", {
      errorClass: error instanceof Error ? error.constructor.name : typeof error,
      code: error instanceof AppwriteException ? error.code : undefined,
      type: error instanceof AppwriteException ? error.type : undefined,
      message:
        error instanceof AppwriteException
          ? "Appwrite OAuth token creation failed"
          : "OAuth token creation failed",
    })
    redirect("/login?error=oauth")
  }

  redirect(authorizationUrl)
}

export async function forgotPasswordAction(
  _state: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const email = field(formData, "email")
  if (!validateEmail(email)) return { error: "Enter a valid email address." }

  try {
    await startPasswordRecovery(email)
  } catch (error) {
    return { error: getAuthErrorMessage(error) }
  }

  return {
    success:
      "Check your email for a password reset link. It expires in one hour.",
  }
}

export async function resetPasswordAction(
  _state: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const userId = field(formData, "userId")
  const secret = field(formData, "secret")
  const password = field(formData, "password")
  const confirmPassword = field(formData, "confirmPassword")

  if (!isValidAuthTokenInput(userId, secret)) {
    return { error: "This recovery link is invalid." }
  }
  if (!validatePassword(password)) {
    return { error: "Password must contain at least 8 characters." }
  }
  if (password !== confirmPassword) {
    return { error: "Passwords do not match." }
  }

  try {
    await resetPassword(userId, secret, password)
  } catch (error) {
    return { error: getAuthErrorMessage(error) }
  }

  redirect("/login?reset=success")
}

export async function signOutAction(_formData: FormData) {
  void _formData
  await signOut()
  redirect("/")
}
