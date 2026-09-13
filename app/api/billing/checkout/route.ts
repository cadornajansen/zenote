import { getCurrentUser } from "@/lib/auth"
import { createQrPhCheckout } from "@/lib/billing"
import { isSameOriginRequest } from "@/lib/request-security"

export const runtime = "nodejs"

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 })
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: "Please sign in to add credits." }, { status: 401 })
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object" || !["payg", "starter", "power", "max"].includes((body as Record<string, unknown>).type as string))
    return Response.json({ error: "Invalid credit purchase." }, { status: 400 })
  try {
    const checkout = await createQrPhCheckout(user.$id, body as { type: "payg" | "starter" | "power" | "max"; amountPhpCentavos?: number })
    return Response.json(checkout, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Checkout could not be created." }, { status: 503 })
  }
}
