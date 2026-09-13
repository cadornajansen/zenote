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
  isTrustedOAuthAuthorizationUrl,
} from "@/lib/appwrite-server"

export type AuthUser = Pick<
  Models.User<Models.Preferences>,
  "$id" | "email" | "name"
>

const sessionCookieOptions = () => ({
  httpOnly: true as const,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
})

export function applicationUrl(path: string) {
  const configured = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  const base = new URL(configured)
  if (
    (base.protocol !== "http:" && base.protocol !== "https:") ||
    base.username ||
    base.password ||
    (process.env.NODE_ENV === "production" && base.protocol !== "https:")
  )
    throw new Error("NEXT_PUBLIC_APP_URL is not a trusted application origin")
  return new URL(path, `${base.origin}/`).toString()
}

export function isValidAuthTokenInput(userId: string, secret: string) {
  return (
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/.test(userId) &&
    secret.length > 0 &&
    secret.length <= 2048
  )
}

async function storeSession(session: Models.Session) {
  const cookieStore = await cookies()
  cookieStore.set(APPWRITE_SESSION_COOKIE, session.secret, {
    ...sessionCookieOptions(),
    expires: new Date(session.expire),
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
  const authorizationUrl = await account.createOAuth2Token({
    provider: OAuthProvider.Google,
    success: applicationUrl("/auth/oauth/callback"),
    failure: applicationUrl("/login?error=oauth"),
  })
  if (!isTrustedOAuthAuthorizationUrl(authorizationUrl, "google"))
    throw new Error("Appwrite returned an untrusted OAuth URL")
  return authorizationUrl
}

export async function completeGoogleSignIn(userId: string, secret: string) {
  if (!isValidAuthTokenInput(userId, secret))
    throw new Error("Invalid OAuth callback")
  const { account } = createAdminServerClient()
  const session = await account.createSession({ userId, secret })
  await storeSession(session)
}

export async function signOut() {
  const cookieStore = await cookies()

  try {
    const client = await createSessionClient()
    await client?.account.deleteSession({ sessionId: "current" })
  } finally {
    cookieStore.set(APPWRITE_SESSION_COOKIE, "", {
      ...sessionCookieOptions(),
      expires: new Date(0),
    })
  }
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const client = await createSessionClient()
    if (!client) return null
    const user = await client.account.get()
    return { $id: user.$id, email: user.email, name: user.name }
  } catch {
    return null
  }
}

export async function startPasswordRecovery(email: string) {
  const { account } = createAdminServerClient()
  try {
    await account.createRecovery({
      email,
      url: applicationUrl("/reset-password"),
    })
  } catch (error) {
    // Recovery is intentionally account-enumeration resistant.
    if (error instanceof AppwriteException && error.type === "user_not_found")
      return
    throw error
  }
}

export async function resetPassword(
  userId: string,
  secret: string,
  password: string
) {
  if (!isValidAuthTokenInput(userId, secret))
    throw new Error("Invalid recovery request")
  const { account } = createAdminServerClient()
  await account.updateRecovery({ userId, secret, password })
}

export function getAuthErrorMessage(error: unknown) {
  if (!(error instanceof AppwriteException)) {
    return "Unable to connect. Try again."
  }

  switch (error.type) {
    case "user_invalid_credentials":
    case "user_not_found":
      return "Invalid email or password."
    case "user_already_exists":
      return "An account with this email already exists."
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
