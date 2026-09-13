import "server-only"

import { createHash, randomUUID } from "node:crypto"
import { AppwriteException, Query, type Models } from "node-appwrite"
import { createAdminServerClient } from "@/lib/appwrite-server"
import { CREDIT_CONFIG, modelCreditWeight } from "@/lib/pricing"
import { getModel } from "@/lib/models"

type Bucket = "free" | "purchased"
type TransactionType = "free_monthly_grant" | "purchase" | "chat_usage" | "adjustment" | "refund"
type Account = Models.Row & { userId: string; freeCredits: number; purchasedCredits: number; freeGrantPeriod: string }
type Reservation = Models.Row & { userId: string; requestedModel: string; reservedCredits: number; reservedFreeCredits: number; reservedPurchasedCredits: number; freeGrantPeriod: string; status: "reserved" | "settled" | "released"; expiresAt: string }
export type CreditSummary = { freeCredits: number; purchasedCredits: number; freeGrantPeriod: string; totalCredits: number; monthlyAllocation: number }

export class InsufficientCreditsError extends Error {
  code = "insufficient_credits"
  status = 402
  constructor(public requiredCredits: number, public availableCredits: number, public modelId: string) {
    super(`You need ${requiredCredits} credits to use ${getModel(modelId)?.name ?? "this model"}. Add credits or choose another model.`)
  }
}

function db() {
  const databaseId = process.env.APPWRITE_DATABASE_ID
  if (!databaseId) throw new Error("APPWRITE_DATABASE_ID is required")
  return { databaseId, tablesDB: createAdminServerClient().tablesDB }
}
function month(now = new Date()) { return now.toISOString().slice(0, 7) }
function stableId(value: string) { return createHash("sha256").update(value).digest("hex").slice(0, 36) }
function accountId(userId: string) { return stableId(`credits:account:${userId}`) }
function transactionId(reference: string, bucket: Bucket) { return stableId(`credits:transaction:${reference}:${bucket}`) }

async function ensureAccount(userId: string) {
  const { databaseId, tablesDB } = db()
  const rowId = accountId(userId)
  try {
    await tablesDB.createRow({ databaseId, tableId: "credit_accounts", rowId, permissions: [], data: { userId, freeCredits: 0, purchasedCredits: 0, freeGrantPeriod: "" } })
  } catch (error) {
    if (!(error instanceof AppwriteException && error.code === 409)) throw error
  }
  return rowId
}

async function transaction<T>(work: (transactionId: string) => Promise<T>): Promise<T> {
  const { tablesDB } = db()
  for (let attempt = 0; attempt < 5; attempt++) {
    const tx = await tablesDB.createTransaction({ ttl: 60 })
    let committing = false
    let result: T
    try {
      result = await work(tx.$id)
      committing = true
      await tablesDB.updateTransaction({ transactionId: tx.$id, commit: true })
      return result
    } catch (error) {
      if (committing) {
        const state = await tablesDB.getTransaction({ transactionId: tx.$id }).catch(() => null)
        if (state?.status === "committed") return result!
      }
      await tablesDB.updateTransaction({ transactionId: tx.$id, rollback: true }).catch(() => {})
      if (!(error instanceof AppwriteException && error.code === 409) || attempt === 4) throw error
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)))
    }
  }
  throw new Error("Credit transaction could not be completed")
}

async function getAccountInTransaction(userId: string, tx: string, now = new Date()) {
  const { databaseId, tablesDB } = db()
  const rowId = await ensureAccount(userId)
  // Stage a write before the read so concurrent settlements conflict instead of read/compare racing.
  await tablesDB.incrementRowColumn({ databaseId, tableId: "credit_accounts", rowId, column: "freeCredits", value: 1, transactionId: tx })
  let account = await tablesDB.getRow<Account>({ databaseId, tableId: "credit_accounts", rowId, transactionId: tx })
  await tablesDB.decrementRowColumn({ databaseId, tableId: "credit_accounts", rowId, column: "freeCredits", value: 1, min: 0, transactionId: tx })
  account = { ...account, freeCredits: account.freeCredits - 1 }
  const currentPeriod = month(now)
  if (account.freeGrantPeriod !== currentPeriod) {
    const allocation = CREDIT_CONFIG.freeMonthlyCredits()
    account = await tablesDB.updateRow<Account>({ databaseId, tableId: "credit_accounts", rowId, transactionId: tx, data: { freeCredits: allocation, freeGrantPeriod: currentPeriod } })
    await tablesDB.createRow({ databaseId, tableId: "credit_transactions", rowId: transactionId(`free:${userId}:${currentPeriod}`, "free"), permissions: [], transactionId: tx, data: { userId, type: "free_monthly_grant", amount: allocation, bucket: "free", balanceAfter: allocation, referenceType: "monthly_grant", referenceId: currentPeriod, idempotencyKey: `free:${userId}:${currentPeriod}`, metadataJson: null } }).catch((error) => { if (!(error instanceof AppwriteException && error.code === 409)) throw error })
  }
  return account
}

async function releaseExpiredReservations(
  account: Account,
  tx: string,
  now: Date
) {
  const { databaseId, tablesDB } = db()
  const expired = await tablesDB.listRows<Reservation>({
    databaseId,
    tableId: "credit_reservations",
    transactionId: tx,
    queries: [
      Query.equal("userId", account.userId),
      Query.equal("status", "reserved"),
      Query.lessThanEqual("expiresAt", now.toISOString()),
      Query.limit(100),
    ],
  })
  let freeRefund = 0
  let purchasedRefund = 0
  for (const reservation of expired.rows) {
    if (reservation.freeGrantPeriod === account.freeGrantPeriod)
      freeRefund += reservation.reservedFreeCredits
    purchasedRefund += reservation.reservedPurchasedCredits
    await tablesDB.updateRow({
      databaseId,
      tableId: "credit_reservations",
      rowId: reservation.$id,
      transactionId: tx,
      data: { status: "released" },
    })
  }
  if (!freeRefund && !purchasedRefund) return account
  return tablesDB.updateRow<Account>({
    databaseId,
    tableId: "credit_accounts",
    rowId: accountId(account.userId),
    transactionId: tx,
    data: {
      freeCredits: account.freeCredits + freeRefund,
      purchasedCredits: account.purchasedCredits + purchasedRefund,
    },
  })
}

function debit(account: Account, amount: number) {
  const fromFree = Math.min(account.freeCredits, amount)
  const fromPurchased = amount - fromFree
  if (fromPurchased > account.purchasedCredits) throw new InsufficientCreditsError(amount, account.freeCredits + account.purchasedCredits, "")
  return { freeCredits: account.freeCredits - fromFree, purchasedCredits: account.purchasedCredits - fromPurchased, fromFree, fromPurchased }
}

async function writeLedger(tx: string, data: { userId: string; type: TransactionType; amount: number; bucket: Bucket; balanceAfter: number; referenceType: string; referenceId: string; idempotencyKey: string }) {
  const { databaseId, tablesDB } = db()
  await tablesDB.createRow({ databaseId, tableId: "credit_transactions", rowId: transactionId(data.idempotencyKey, data.bucket), permissions: [], transactionId: tx, data: { ...data, metadataJson: null } })
}

export async function getCreditSummary(
  userId: string,
  now = new Date()
): Promise<CreditSummary> {
  const account = await transaction(async (tx) => {
    const current = await getAccountInTransaction(userId, tx, now)
    return releaseExpiredReservations(current, tx, now)
  })
  return {
    freeCredits: account.freeCredits,
    purchasedCredits: account.purchasedCredits,
    freeGrantPeriod: account.freeGrantPeriod,
    totalCredits: account.freeCredits + account.purchasedCredits,
    monthlyAllocation: CREDIT_CONFIG.freeMonthlyCredits(),
  }
}

export async function reserveChatCredits(
  userId: string,
  requestedModel: string,
  runId: string = randomUUID(),
  now = new Date()
) {
  const fallbackModel = getModel(requestedModel)?.fallbackModelId
  const required = Math.max(
    modelCreditWeight(requestedModel),
    fallbackModel ? modelCreditWeight(fallbackModel) : 0
  )
  const { databaseId, tablesDB } = db()
  return transaction(async (tx) => {
    let account = await getAccountInTransaction(userId, tx, now)
    account = await releaseExpiredReservations(account, tx, now)
    try {
      const prior = await tablesDB.getRow<Reservation>({ databaseId, tableId: "credit_reservations", rowId: runId, transactionId: tx })
      return prior
    } catch (error) {
      if (!(error instanceof AppwriteException && error.code === 404)) throw error
    }
    if (account.freeCredits + account.purchasedCredits < required)
      throw new InsufficientCreditsError(required, account.freeCredits + account.purchasedCredits, requestedModel)
    const held = debit(account, required)
    await tablesDB.updateRow<Account>({
      databaseId,
      tableId: "credit_accounts",
      rowId: accountId(userId),
      transactionId: tx,
      data: {
        freeCredits: held.freeCredits,
        purchasedCredits: held.purchasedCredits,
      },
    })
    return tablesDB.createRow<Reservation>({ databaseId, tableId: "credit_reservations", rowId: runId, permissions: [], transactionId: tx, data: { userId, requestedModel, reservedCredits: required, reservedFreeCredits: held.fromFree, reservedPurchasedCredits: held.fromPurchased, freeGrantPeriod: account.freeGrantPeriod, status: "reserved", expiresAt: new Date(now.getTime() + 300_000).toISOString() } })
  })
}

export async function settleChatCredits(input: { reservationId: string; actualModel: string; now?: Date; charge?: boolean; usage: { conversationId?: string; messageId?: string; requestedModel: string; provider: string; fallbackUsed: boolean; inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; totalTokens?: number; latencyMs: number; status: "success" | "failed" | "aborted"; providerRequestId?: string; errorType?: string } }) {
  const { databaseId, tablesDB } = db()
  return transaction(async (tx) => {
    const reservation = await tablesDB.getRow<Reservation>({ databaseId, tableId: "credit_reservations", rowId: input.reservationId, transactionId: tx })
    if (reservation.status !== "reserved") return
    const now = input.now ?? new Date()
    const account = await getAccountInTransaction(reservation.userId, tx, now)
    const expired = Date.parse(reservation.expiresAt) <= now.getTime()
    const charged = (input.charge ?? input.usage.status === "success") && !expired
      ? modelCreditWeight(input.actualModel)
      : 0
    if (charged > reservation.reservedCredits) throw new Error("Actual model exceeds reserved credit price")
    const chargedFree = Math.min(reservation.reservedFreeCredits, charged)
    const chargedPurchased = charged - chargedFree
    const refundFree = reservation.freeGrantPeriod === account.freeGrantPeriod
      ? reservation.reservedFreeCredits - chargedFree
      : 0
    const refundPurchased = reservation.reservedPurchasedCredits - chargedPurchased
    const next = await tablesDB.updateRow<Account>({ databaseId, tableId: "credit_accounts", rowId: accountId(reservation.userId), transactionId: tx, data: { freeCredits: account.freeCredits + refundFree, purchasedCredits: account.purchasedCredits + refundPurchased } })
    if (chargedFree) await writeLedger(tx, { userId: reservation.userId, type: "chat_usage", amount: -chargedFree, bucket: "free", balanceAfter: next.freeCredits, referenceType: "chat", referenceId: input.reservationId, idempotencyKey: `${input.reservationId}:free` })
    if (chargedPurchased) await writeLedger(tx, { userId: reservation.userId, type: "chat_usage", amount: -chargedPurchased, bucket: "purchased", balanceAfter: next.purchasedCredits, referenceType: "chat", referenceId: input.reservationId, idempotencyKey: `${input.reservationId}:purchased` })
    await tablesDB.updateRow({ databaseId, tableId: "credit_reservations", rowId: reservation.$id, transactionId: tx, data: { status: charged ? "settled" : "released" } })
    await tablesDB.createRow({ databaseId, tableId: "usage_events", rowId: stableId(`usage:${input.reservationId}`), permissions: [], transactionId: tx, data: { userId: reservation.userId, conversationId: input.usage.conversationId ?? null, messageId: input.usage.messageId ?? null, operation: "chat", requestedModel: input.usage.requestedModel, actualModel: input.actualModel, provider: input.usage.provider, fallbackUsed: input.usage.fallbackUsed, inputTokens: input.usage.inputTokens ?? null, outputTokens: input.usage.outputTokens ?? null, cachedInputTokens: input.usage.cachedInputTokens ?? null, totalTokens: input.usage.totalTokens ?? null, latencyMs: input.usage.latencyMs, status: input.usage.status, creditsCharged: charged, estimatedProviderCostMicrousd: null, providerRequestId: input.usage.providerRequestId ?? null, errorType: input.usage.errorType ?? null } })
    return { creditsCharged: charged, account: next }
  })
}

export async function grantPurchaseCredits(input: { purchaseId: string; userId: string; credits: number }) {
  const { databaseId, tablesDB } = db()
  return transaction(async (tx) => {
    await getAccountInTransaction(input.userId, tx)
    const next = await tablesDB.incrementRowColumn<Account>({ databaseId, tableId: "credit_accounts", rowId: accountId(input.userId), column: "purchasedCredits", value: input.credits, transactionId: tx })
    await writeLedger(tx, { userId: input.userId, type: "purchase", amount: input.credits, bucket: "purchased", balanceAfter: next.purchasedCredits, referenceType: "purchase", referenceId: input.purchaseId, idempotencyKey: `purchase:${input.purchaseId}` })
    return next
  })
}

export async function fulfillVerifiedPurchase(input: { purchaseId: string; paymongoResourceId: string; paymongoPaymentIntentId?: string; paymongoPaymentId?: string }) {
  const { databaseId, tablesDB } = db()
  return transaction(async (tx) => {
    const purchase = await tablesDB.getRow<Models.Row & { userId: string; credits: number; status: string }>({ databaseId, tableId: "purchases", rowId: input.purchaseId, transactionId: tx })
    if (purchase.status === "paid") return purchase
    if (purchase.status !== "pending") throw new Error("Purchase cannot be fulfilled")
    await getAccountInTransaction(purchase.userId, tx)
    const next = await tablesDB.incrementRowColumn<Account>({ databaseId, tableId: "credit_accounts", rowId: accountId(purchase.userId), column: "purchasedCredits", value: purchase.credits, transactionId: tx })
    await writeLedger(tx, { userId: purchase.userId, type: "purchase", amount: purchase.credits, bucket: "purchased", balanceAfter: next.purchasedCredits, referenceType: "purchase", referenceId: purchase.$id, idempotencyKey: `purchase:${purchase.$id}` })
    return tablesDB.updateRow({ databaseId, tableId: "purchases", rowId: purchase.$id, transactionId: tx, data: { status: "paid", paidAt: new Date().toISOString(), paymongoResourceId: input.paymongoResourceId, paymongoPaymentIntentId: input.paymongoPaymentIntentId ?? null, paymongoPaymentId: input.paymongoPaymentId ?? null } })
  })
}

export async function listRecentCreditActivity(userId: string) {
  const { databaseId, tablesDB } = db()
  const [transactions, usage, purchases] = await Promise.all([
    tablesDB.listRows<Models.Row & { amount: number; type: string }>({ databaseId, tableId: "credit_transactions", queries: [Query.equal("userId", userId), Query.orderDesc("$createdAt"), Query.limit(10)] }),
    tablesDB.listRows<Models.Row & { actualModel?: string; creditsCharged: number }>({ databaseId, tableId: "usage_events", queries: [Query.equal("userId", userId), Query.orderDesc("$createdAt"), Query.limit(10)] }),
    tablesDB.listRows<Models.Row & { type: string; amountPhpCentavos: number; credits: number; status: string }>({ databaseId, tableId: "purchases", queries: [Query.equal("userId", userId), Query.orderDesc("$createdAt"), Query.limit(10)] }),
  ])
  return {
    transactions: transactions.rows.map((row) => ({
      $id: row.$id,
      $createdAt: row.$createdAt,
      amount: row.amount,
      type: row.type,
    })),
    usage: usage.rows.map((row) => ({
      $id: row.$id,
      $createdAt: row.$createdAt,
      actualModel: row.actualModel,
      creditsCharged: row.creditsCharged,
    })),
    purchases: purchases.rows.map((row) => ({
      $id: row.$id,
      $createdAt: row.$createdAt,
      type: row.type,
      amountPhpCentavos: row.amountPhpCentavos,
      credits: row.credits,
      status: row.status,
    })),
  }
}
