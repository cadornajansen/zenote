import { Account, Client } from "appwrite"

const endpoint =
  process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT ??
  "https://sgp.cloud.appwrite.io/v1"
const projectId =
  process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID ?? "6a9e3f7c0019355433ad"

export const appwriteClient = new Client()
  .setEndpoint(endpoint)
  .setProject(projectId)
export const account = new Account(appwriteClient)

export function pingAppwrite() {
  return appwriteClient.ping()
}
