import "server-only"

import { cookies } from "next/headers"
import { Account, Client, Functions, Storage, TablesDB } from "node-appwrite"

const endpoint =
  process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT ??
  "https://sgp.cloud.appwrite.io/v1"
const projectId =
  process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID ?? "6a9e3f7c0019355433ad"
const apiKey = process.env.APPWRITE_API_KEY
const executionApiKey = process.env.APPWRITE_EXECUTION_API_KEY || apiKey

export const APPWRITE_SESSION_COOKIE = "zenote-session"

export function isTrustedAppwriteOAuthUrl(value: string) {
  try {
    const url = new URL(value)
    const trusted = new URL(endpoint)
    return url.origin === trusted.origin && url.protocol === trusted.protocol
  } catch {
    return false
  }
}

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

  return {
    account: new Account(client),
    tablesDB: new TablesDB(client),
    storage: new Storage(client),
  }
}

export function createExecutionServerClient() {
  if (!executionApiKey) {
    throw new Error(
      "APPWRITE_EXECUTION_API_KEY or APPWRITE_API_KEY is required for Function execution"
    )
  }
  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(executionApiKey)
  return { functions: new Functions(client) }
}

export async function createSessionClient() {
  const session = (await cookies()).get(APPWRITE_SESSION_COOKIE)?.value

  if (!session) return null

  const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setSession(session)

  return {
    account: new Account(client),
    tablesDB: new TablesDB(client),
    storage: new Storage(client),
  }
}
