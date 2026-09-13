import { getCurrentUser } from "@/lib/auth"
import { getCreditSummary } from "@/lib/usage"

export const runtime = "nodejs"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 })
  const summary = await getCreditSummary(user.$id)
  return Response.json(summary, { headers: { "Cache-Control": "no-store" } })
}
