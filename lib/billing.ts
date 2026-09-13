import "server-only"

import { randomUUID } from "node:crypto"
import { ID, type Models } from "node-appwrite"
import { createAdminServerClient } from "@/lib/appwrite-server"
import { resolvePurchaseOffer, type PurchaseType } from "@/lib/pricing"
import { fulfillVerifiedPurchase } from "@/lib/usage"

type Purchase = Models.Row & { userId: string; paymongoResourceId: string; type: PurchaseType; amountPhpCentavos: number; credits: number; status: "pending" | "paid" | "expired" | "failed" | "refunded" }

function db() {
  const databaseId = process.env.APPWRITE_DATABASE_ID
  if (!databaseId) throw new Error("APPWRITE_DATABASE_ID is required")
  return { databaseId, tablesDB: createAdminServerClient().tablesDB }
}

function paymongoSecret() {
  const key = process.env.PAYMONGO_SECRET_KEY
  if (!key) throw new Error("Payments are not configured.")
  return key
}

function appUrl() {
  const value = process.env.NEXT_PUBLIC_APP_URL
  if (!value) throw new Error("NEXT_PUBLIC_APP_URL is required for checkout.")
  return new URL(value).origin
}

function safeCheckoutUrl(value: unknown) {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname === "checkout.paymongo.com"
      ? url.toString()
      : null
  } catch {
    return null
  }
}

export async function createQrPhCheckout(userId: string, input: { type: PurchaseType; amountPhpCentavos?: number }) {
  const offer = resolvePurchaseOffer(input)
  const { databaseId, tablesDB } = db()
  const purchaseId = ID.unique()
  const idempotencyKey = randomUUID()
  await tablesDB.createRow({ databaseId, tableId: "purchases", rowId: purchaseId, permissions: [], data: { userId, paymongoResourceId: `pending_${purchaseId}`, paymongoPaymentIntentId: null, paymongoPaymentId: null, type: offer.type, amountPhpCentavos: offer.amountPhpCentavos, credits: offer.credits, status: "pending", idempotencyKey, paidAt: null } })
  let definitiveFailure = false
  try {
    const requestBody = JSON.stringify({
      data: { attributes: {
        payment_method_types: ["qrph"],
        line_items: [{ currency: "PHP", amount: offer.amountPhpCentavos, name: `${offer.label} Zenote Credits`, quantity: 1 }],
        reference_number: purchaseId,
        success_url: `${appUrl()}/settings?checkout=complete`,
        cancel_url: `${appUrl()}/settings?checkout=cancelled`,
      } },
    })
    let response: Response | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetch("https://api.paymongo.com/v2/checkout_sessions", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${paymongoSecret()}:`).toString("base64")}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: requestBody,
      cache: "no-store",
        })
      } catch {
        if (attempt === 1) throw new Error("Checkout transport failed")
        continue
      }
      if (response.status < 500) break
    }
    if (!response) throw new Error("Checkout transport failed")
    definitiveFailure = response.status >= 400 && response.status < 500
    const body = await response.json().catch(() => null)
    const checkoutId = body?.data?.id
    const checkoutUrl = safeCheckoutUrl(body?.data?.attributes?.checkout_url)
    if (!response.ok || typeof checkoutId !== "string" || !checkoutUrl) throw new Error("Checkout could not be created.")
    await tablesDB.updateRow({ databaseId, tableId: "purchases", rowId: purchaseId, data: { paymongoResourceId: checkoutId } })
    return { purchaseId, checkoutUrl }
  } catch (error) {
    if (definitiveFailure)
      await tablesDB.updateRow({ databaseId, tableId: "purchases", rowId: purchaseId, data: { status: "failed" } }).catch(() => {})
    throw error instanceof Error && error.message === "Payments are not configured." ? error : new Error("Checkout could not be created. Please try again.")
  }
}

function nested(object: unknown, path: string[]): unknown {
  return path.reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, object)
}

export async function fulfillPaymongoCheckout(event: unknown) {
  if (nested(event, ["data", "type"]) !== "checkout_session.payment.paid") return { handled: false }
  const checkout = nested(event, ["data", "data"])
  const checkoutId = nested(checkout, ["id"])
  const attributes = nested(checkout, ["attributes"])
  const reference = nested(attributes, ["reference_number"])
  const payments = nested(attributes, ["payments"])
  if (!Array.isArray(payments)) throw new Error("Invalid paid checkout event")
  const payment = payments.find((candidate) =>
    nested(candidate, ["attributes", "status"]) === "paid" &&
    nested(candidate, ["attributes", "source", "type"]) === "qrph"
  )
  const currency = nested(payment, ["attributes", "currency"])
  const amount = nested(payment, ["attributes", "amount"])
  if (typeof checkoutId !== "string" || typeof reference !== "string" || currency !== "PHP" || !Number.isSafeInteger(amount)) throw new Error("Invalid paid checkout event")
  const { databaseId, tablesDB } = db()
  const purchase = await tablesDB.getRow<Purchase>({ databaseId, tableId: "purchases", rowId: reference })
  const pendingResourceId = `pending_${purchase.$id}`
  if (purchase.amountPhpCentavos !== amount || purchase.status === "refunded" || ![checkoutId, pendingResourceId].includes(purchase.paymongoResourceId)) throw new Error("Unknown paid checkout")
  const paymentIntentId = nested(attributes, ["payment_intent", "id"])
  const paymentId = nested(payment, ["id"])
  await fulfillVerifiedPurchase({ purchaseId: purchase.$id, paymongoResourceId: checkoutId, ...(typeof paymentIntentId === "string" ? { paymongoPaymentIntentId: paymentIntentId } : {}), ...(typeof paymentId === "string" ? { paymongoPaymentId: paymentId } : {}) })
  return { handled: true }
}
