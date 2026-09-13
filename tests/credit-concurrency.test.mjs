import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { beforeEach, test } from "node:test"
import ts from "typescript"
import { admissionStore } from "./admission-store.mjs"

let store
globalThis.__creditAdmin = () => store
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }
    if (specifier === "@/lib/appwrite-server") return { url: "data:text/javascript,export const createAdminServerClient=()=>globalThis.__creditAdmin()", shortCircuit: true }
    if (specifier.startsWith("@/")) return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith(".ts")) return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText }
    return next(url, context)
  },
})

const usage = await import("../lib/usage.ts")
const { fulfillPaymongoCheckout } = await import("../lib/billing.ts")
const { POST: webhookPost, verifyPaymongoSignature } = await import("../app/api/paymongo/webhook/route.ts")
const september = new Date("2026-09-01T00:00:00Z")
const october = new Date("2026-10-01T00:00:00Z")

beforeEach(() => {
  store = admissionStore()
  process.env.APPWRITE_DATABASE_ID = "test"
  process.env.ZENOTE_FREE_MONTHLY_CREDITS = "5"
  process.env.PAYMONGO_WEBHOOK_SECRET = "whsk_test"
})

function rows(table) {
  return [...store.rows.entries()].filter(([key]) => key.startsWith(`${table}/`)).map(([, row]) => row)
}

function successUsage(status = "success") {
  return { requestedModel: "gpt-5-6-sol", provider: "assemblyai", fallbackUsed: false, latencyMs: 10, status }
}

async function seedPurchase(id = "purchase-1", checkoutId = "cs_1") {
  await store.tablesDB.createRow({ tableId: "purchases", rowId: id, permissions: [], data: { userId: "owner", paymongoResourceId: checkoutId, type: "payg", amountPhpCentavos: 5000, credits: 200, status: "pending", idempotencyKey: id } })
}

function paidEvent(checkoutId = "cs_1", reference = "purchase-1", paymentId = "pay_1") {
  return { event_type: "send.webhook", data: { type: "checkout_session.payment.paid", resource: "checkout_session", livemode: false, data: { id: checkoutId, type: "checkout_session", attributes: { reference_number: reference, payment_intent: { id: "pi_1" }, payments: [{ id: paymentId, attributes: { amount: 5000, currency: "PHP", status: "paid", source: { type: "qrph" } } }] } } } }
}

test("ten simultaneous first reads create one monthly grant", async () => {
  const summaries = await Promise.all(Array.from({ length: 10 }, () => usage.getCreditSummary("owner", september)))
  assert.ok(summaries.every((summary) => summary.freeCredits === 5))
  assert.equal(rows("credit_transactions").filter((row) => row.type === "free_monthly_grant").length, 1)
})

test("month rollover under concurrency grants once and preserves purchased credits", async () => {
  await usage.getCreditSummary("owner", september)
  await usage.reserveChatCredits("owner", "gpt-5-nano", "september-usage", september)
  await usage.settleChatCredits({ reservationId: "september-usage", actualModel: "gpt-5-nano", now: september, usage: { ...successUsage(), requestedModel: "gpt-5-nano" } })
  await usage.grantPurchaseCredits({ purchaseId: "manual-purchase", userId: "owner", credits: 20 })
  const summaries = await Promise.all(Array.from({ length: 10 }, () => usage.getCreditSummary("owner", october)))
  assert.ok(summaries.every((summary) => summary.freeCredits === 5 && summary.purchasedCredits === 20))
  assert.equal(rows("credit_transactions").filter((row) => row.type === "free_monthly_grant").length, 2)
})

test("five credits cannot be reserved twice and ten requests never go negative", async () => {
  const two = await Promise.allSettled([usage.reserveChatCredits("owner", "gpt-5-6-sol", "run-a", september), usage.reserveChatCredits("owner", "gpt-5-6-sol", "run-b", september)])
  assert.equal(two.filter((result) => result.status === "fulfilled").length, 1)
  assert.equal((await usage.getCreditSummary("owner", september)).totalCredits, 0)

  store = admissionStore()
  const ten = await Promise.allSettled(Array.from({ length: 10 }, (_, index) => usage.reserveChatCredits("owner", "gpt-5-nano", `run-${index}`, september)))
  assert.equal(ten.filter((result) => result.status === "fulfilled").length, 5)
  assert.equal((await usage.getCreditSummary("owner", september)).totalCredits, 0)
})

test("reservation covers a more expensive configured fallback", async () => {
  process.env.ZENOTE_FREE_MONTHLY_CREDITS = "1"
  await assert.rejects(
    usage.reserveChatCredits("owner", "gpt-5-mini", "higher-fallback", september),
    { code: "insufficient_credits", requiredCredits: 2 }
  )
})

test("expired or released reservations cannot later charge", async () => {
  await usage.reserveChatCredits("owner", "gpt-5-6-sol", "expired", september)
  await usage.settleChatCredits({ reservationId: "expired", actualModel: "gpt-5-6-sol", now: new Date(september.getTime() + 300_001), usage: successUsage() })
  await usage.settleChatCredits({ reservationId: "expired", actualModel: "gpt-5-6-sol", now: new Date(september.getTime() + 300_002), usage: successUsage() })
  assert.equal((await usage.getCreditSummary("owner", september)).totalCredits, 5)
  assert.equal(rows("credit_transactions").filter((row) => row.type === "chat_usage").length, 0)
})

test("duplicate settlement charges once and cheaper fallback refunds once", async () => {
  await usage.reserveChatCredits("owner", "gpt-5-6-sol", "duplicate", september)
  await Promise.all([0, 1].map(() => usage.settleChatCredits({ reservationId: "duplicate", actualModel: "gpt-5-6-sol", now: september, usage: successUsage() })))
  assert.equal((await usage.getCreditSummary("owner", september)).totalCredits, 0)
  assert.equal(rows("credit_transactions").filter((row) => row.type === "chat_usage").length, 1)

  store = admissionStore()
  await usage.reserveChatCredits("owner", "gpt-5-6-sol", "fallback", september)
  await usage.settleChatCredits({ reservationId: "fallback", actualModel: "gpt-5-6-terra", now: september, usage: { ...successUsage(), fallbackUsed: true } })
  await usage.settleChatCredits({ reservationId: "fallback", actualModel: "gpt-5-6-terra", now: september, usage: { ...successUsage(), fallbackUsed: true } })
  assert.equal((await usage.getCreditSummary("owner", september)).totalCredits, 2)
  assert.deepEqual(rows("credit_transactions").filter((row) => row.type === "chat_usage").map((row) => row.amount), [-3])
})

test("failure releases once and simultaneous finalize/release cannot corrupt balance", async () => {
  await usage.reserveChatCredits("owner", "gpt-5-6-sol", "failed", september)
  await Promise.all([0, 1].map(() => usage.settleChatCredits({ reservationId: "failed", actualModel: "gpt-5-6-sol", now: september, usage: successUsage("failed") })))
  assert.equal((await usage.getCreditSummary("owner", september)).totalCredits, 5)

  store = admissionStore()
  await usage.reserveChatCredits("owner", "gpt-5-6-sol", "race", september)
  await Promise.allSettled([
    usage.settleChatCredits({ reservationId: "race", actualModel: "gpt-5-6-sol", now: september, usage: successUsage("success") }),
    usage.settleChatCredits({ reservationId: "race", actualModel: "gpt-5-6-sol", now: september, usage: successUsage("failed") }),
  ])
  const total = (await usage.getCreditSummary("owner", september)).totalCredits
  assert.ok(total === 0 || total === 5)
  assert.equal(rows("usage_events").length, 1)
})

test("material aborted generation records aborted status and charges once", async () => {
  await usage.reserveChatCredits("owner", "gpt-5-6-sol", "material-abort", september)
  await usage.settleChatCredits({ reservationId: "material-abort", actualModel: "gpt-5-6-sol", now: september, charge: true, usage: successUsage("aborted") })
  await usage.settleChatCredits({ reservationId: "material-abort", actualModel: "gpt-5-6-sol", now: september, charge: true, usage: successUsage("aborted") })
  assert.equal((await usage.getCreditSummary("owner", september)).totalCredits, 0)
  assert.equal(rows("usage_events")[0].status, "aborted")
  assert.equal(rows("usage_events")[0].creditsCharged, 5)
})

test("ten duplicate and two racing paid webhooks grant one purchase once", async () => {
  await seedPurchase()
  await Promise.all(Array.from({ length: 10 }, () => fulfillPaymongoCheckout(paidEvent())))
  await Promise.all([fulfillPaymongoCheckout(paidEvent("cs_1", "purchase-1", "pay_2")), fulfillPaymongoCheckout(paidEvent("cs_1", "purchase-1", "pay_3"))])
  assert.equal((await usage.getCreditSummary("owner", september)).purchasedCredits, 200)
  assert.equal(rows("credit_transactions").filter((row) => row.type === "purchase").length, 1)
  assert.equal(rows("purchases")[0].status, "paid")
})

test("transaction failure followed by webhook retry grants exactly once", async () => {
  await seedPurchase()
  const update = store.tablesDB.updateTransaction
  let fail = true
  store.tablesDB.updateTransaction = async (input) => {
    if (input.commit && fail) { fail = false; throw new Error("transient commit failure") }
    return update(input)
  }
  await assert.rejects(fulfillPaymongoCheckout(paidEvent()))
  await fulfillPaymongoCheckout(paidEvent())
  await fulfillPaymongoCheckout(paidEvent())
  assert.equal((await usage.getCreditSummary("owner", september)).purchasedCredits, 200)
  assert.equal(rows("credit_transactions").filter((row) => row.type === "purchase").length, 1)
})

test("PayMongo signature accepts delayed current-format retries and rejects forgeries", async () => {
  const body = Buffer.from(JSON.stringify(paidEvent()))
  const timestamp = "1496734173"
  const signature = createHmac("sha256", "whsk_test").update(`${timestamp}.${body.toString("utf8")}`).digest("hex")
  assert.equal(verifyPaymongoSignature(`t=${timestamp},te=${signature},li=`, body, "whsk_test"), true)
  assert.equal(verifyPaymongoSignature(`t=${timestamp},te=${"0".repeat(64)},li=`, body, "whsk_test"), false)
  assert.equal(verifyPaymongoSignature(signature, body, "whsk_test"), false)
  await seedPurchase()
  const response = await webhookPost(new Request("https://example.test/api/paymongo/webhook", { method: "POST", headers: { "Paymongo-Signature": `t=${timestamp},te=${"0".repeat(64)},li=` }, body }))
  assert.equal(response.status, 400)
  assert.equal(rows("purchases")[0].status, "pending")
  assert.equal(rows("credit_transactions").length, 0)
})
