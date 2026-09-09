import "server-only"

import { cookies } from "next/headers"
import { Account, Client } from "node-appwrite"

const endpoint =
  process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT ??
  "https://sgp.cloud.appwrite.io/v1"
const projectId =
  process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID ?? "6a9e3f7c0019355433ad"
const apiKey = process.env.APPWRITE_API_KEY

export const APPWRITE_SESSION_COOKIE = "zenote-session"

export function createAdminServerClient() {
  if (!apiKey) {
    throw new Error(
      "APPWRITE_API_KEY is required for server-side authentication"
    )
  }

  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey)

  return { account: new Account(client) }
}

export async function createSessionClient() {
  const session = (await cookies()).get(APPWRITE_SESSION_COOKIE)?.value

  if (!session) return null

  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setSession(session)

  return { account: new Account(client) }
}
