import { createHmac, timingSafeEqual } from "node:crypto"
import { fulfillPaymongoCheckout } from "@/lib/billing"

export const runtime = "nodejs"

export function verifyPaymongoSignature(
  header: string | null,
  body: Buffer,
  secret = process.env.PAYMONGO_WEBHOOK_SECRET,
  mode?: "test" | "live"
) {
  if (!secret || !header) return false
  const values = Object.fromEntries(header.split(",").map((part) => part.trim().split("=", 2)).filter(([key, value]) => key && value))
  const timestamp = values.t
  const signatures = (mode === "test"
    ? [values.te]
    : mode === "live"
      ? [values.li]
      : [values.te, values.li]
  ).filter((value): value is string => typeof value === "string")
  if (!timestamp || !/^\d+$/.test(timestamp)) return false
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(body)
    .digest()
  return signatures.some((signature) => {
    const actual = Buffer.from(signature, "hex")
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  })
}

export async function POST(request: Request) {
  const body = Buffer.from(await request.arrayBuffer())
  if (body.length > 512_000 || !verifyPaymongoSignature(request.headers.get("paymongo-signature"), body))
    return Response.json({ error: "Invalid webhook signature." }, { status: 400 })
  let event: unknown
  try { event = JSON.parse(body.toString("utf8")) } catch { return Response.json({ error: "Malformed webhook." }, { status: 400 }) }
  const livemode = event && typeof event === "object" && "data" in event &&
    event.data && typeof event.data === "object" && "livemode" in event.data
      ? event.data.livemode
      : undefined
  if (typeof livemode !== "boolean" || !verifyPaymongoSignature(request.headers.get("paymongo-signature"), body, undefined, livemode ? "live" : "test"))
    return Response.json({ error: "Invalid webhook signature." }, { status: 400 })
  try {
    const result = await fulfillPaymongoCheckout(event)
    return Response.json({ received: true, handled: result.handled })
  } catch {
    // A non-2xx response requests PayMongo's bounded retry delivery. No payload is logged.
    return Response.json({ error: "Webhook processing failed." }, { status: 500 })
  }
}
