import "server-only"

import { cookies } from "next/headers"
import {
  AppwriteException,
  ID,
  OAuthProvider,
  type Models,
} from "node-appwrite"

import {
  APPWRITE_SESSION_COOKIE,
  createAdminServerClient,
  createSessionClient,
} from "@/lib/appwrite-server"

export type AuthUser = Pick<
  Models.User<Models.Preferences>,
  "$id" | "email" | "name"
>

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

async function storeSession(session: Models.Session) {
  const cookieStore = await cookies()
  cookieStore.set(APPWRITE_SESSION_COOKIE, session.secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: new Date(session.expire),
    path: "/",
  })
}

export async function signUpWithEmail(
  name: string,
  email: string,
  password: string
) {
  const { account } = createAdminServerClient()
  await account.create({ userId: ID.unique(), name, email, password })
  const session = await account.createEmailPasswordSession({ email, password })
  await storeSession(session)
}

export async function signInWithEmail(email: string, password: string) {
  const { account } = createAdminServerClient()
  const session = await account.createEmailPasswordSession({ email, password })
  await storeSession(session)
}

export async function signInWithGoogle() {
  const { account } = createAdminServerClient()
  return account.createOAuth2Token({
    provider: OAuthProvider.Google,
    success: `${appUrl}/auth/oauth/callback`,
    failure: `${appUrl}/login?error=oauth`,
  })
}

export async function completeGoogleSignIn(userId: string, secret: string) {
  const { account } = createAdminServerClient()
  const session = await account.createSession({ userId, secret })
  await storeSession(session)
}

export async function signOut() {
  const cookieStore = await cookies()
  const client = await createSessionClient()

  try {
    await client?.account.deleteSession({ sessionId: "current" })
  } finally {
    cookieStore.delete(APPWRITE_SESSION_COOKIE)
  }
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const client = await createSessionClient()
  if (!client) return null

  try {
    const user = await client.account.get()
    return { $id: user.$id, email: user.email, name: user.name }
  } catch {
    return null
  }
}

export async function startPasswordRecovery(email: string) {
  const { account } = createAdminServerClient()
  await account.createRecovery({ email, url: `${appUrl}/reset-password` })
}

export async function resetPassword(
  userId: string,
  secret: string,
  password: string
) {
  const { account } = createAdminServerClient()
  await account.updateRecovery({ userId, secret, password })
}

export function getAuthErrorMessage(error: unknown) {
  if (!(error instanceof AppwriteException)) {
    return "Unable to connect. Try again."
  }

  switch (error.type) {
    case "user_invalid_credentials":
      return "Invalid email or password."
    case "user_already_exists":
      return "An account with this email already exists."
    case "user_not_found":
      return "No account was found for this email."
    case "user_token_expired":
    case "user_invalid_token":
      return "This recovery link has expired or is invalid."
    case "general_rate_limit_exceeded":
      return "Too many attempts. Please wait and try again."
    default:
      return error.code >= 500
        ? "Unable to connect. Try again."
        : "We could not complete that request. Check your details and try again."
  }
}
