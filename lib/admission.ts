import "server-only"

import { createHash, randomUUID } from "node:crypto"
import { AppwriteException, type Models } from "node-appwrite"
import { createAdminServerClient } from "@/lib/appwrite-server"
import { ATTACHMENT_LIMITS } from "@/lib/attachment-policy"

type Resource = "chat_request" | "attachment_job" | "attachment_bytes"
type Bucket = {
  scope: "user" | "global"
  subjectId: string
  resource: Resource
  window: "minute" | "day" | "lease"
  windowStart: string
}
type Lease = { token: string; expires: number; attachmentId?: string }
type Counter = Models.Row & Bucket & { count: number; leases?: string }
type Charge = { bucket: Bucket; amount: number }
export type Admission = { charges: Charge[]; bucket?: Bucket; token: string }

export class AdmissionError extends Error {
  constructor(
    public code: string,
    public status: number,
    public retryAfter?: number,
  ) {
    super(status === 429
      ? "Your temporary safety limit has been reached. Please try again later."
      : "This service is temporarily unavailable. Please try again later.")
  }
}

export function admissionConfig(env = process.env) {
  const integer = (key: string, fallback: number, max = Number.MAX_SAFE_INTEGER) => {
    const raw = env[key] ?? String(fallback)
    const value = Number(raw)
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > max)
      throw new Error(`Invalid admission configuration: ${key}`)
    return value
  }
  const enabled = (key: string) => {
    const value = env[key] ?? "true"
    if (value !== "true" && value !== "false") throw new Error(`Invalid admission configuration: ${key}`)
    return value === "true"
  }
  const config = {
    chatEnabled: enabled("ZENOTE_CHAT_ENABLED"),
    attachmentsEnabled: enabled("ZENOTE_ATTACHMENTS_ENABLED"),
    chatMinute: integer("ZENOTE_CHAT_PER_MINUTE", 10),
    chatDay: integer("ZENOTE_CHAT_PER_DAY", 200),
    chatConcurrent: integer("ZENOTE_CHAT_MAX_CONCURRENT", 2, 100),
    attachmentDay: integer("ZENOTE_ATTACHMENTS_PER_DAY", 20),
    attachmentBytes: integer("ZENOTE_ATTACHMENT_BYTES_PER_DAY", 104857600),
    attachmentConcurrent: integer("ZENOTE_ATTACHMENTS_MAX_CONCURRENT", 4, 100),
    globalChat: integer("ZENOTE_GLOBAL_CHAT_PER_DAY", 5000),
    globalAttachments: integer("ZENOTE_GLOBAL_ATTACHMENTS_PER_DAY", 500),
    chatLeaseMs: integer("ZENOTE_CHAT_LEASE_SECONDS", 300) * 1000,
    attachmentLeaseMs: integer("ZENOTE_ATTACHMENT_LEASE_SECONDS", 360) * 1000,
  }
  // Must outlive the route deadline / existing Function processing lease.
  if (config.chatLeaseMs < 300000 || config.attachmentLeaseMs < ATTACHMENT_LIMITS.leaseMs ||
      !Number.isSafeInteger(config.chatLeaseMs) || !Number.isSafeInteger(config.attachmentLeaseMs))
    throw new Error("Admission leases are shorter than the operation deadline or invalid")
  return config
}

export function requireAdmissionEnabled(resource: Resource) {
  let config: ReturnType<typeof admissionConfig>
  try { config = admissionConfig() } catch {
    event("admission.denied", resource, "user", "configuration", 503)
    throw new AdmissionError("service_temporarily_unavailable", 503)
  }
  if (!(resource === "chat_request" ? config.chatEnabled : config.attachmentsEnabled)) {
    event("admission.denied", resource, "user", "disabled", 503)
    throw new AdmissionError("service_temporarily_unavailable", 503)
  }
  return config
}

export function utcWindow(window: "minute" | "day", now: number) {
  const size = window === "minute" ? 60000 : 86400000
  return new Date(Math.floor(now / size) * size).toISOString().replace(".000Z", "Z")
}

export function counterId(bucket: Bucket) {
  return createHash("sha256").update(JSON.stringify([
    bucket.scope, bucket.subjectId, bucket.resource, bucket.window, bucket.windowStart,
  ])).digest("hex").slice(0, 36)
}

function client() {
  const databaseId = process.env.APPWRITE_DATABASE_ID
  if (!databaseId) throw new AdmissionError("service_temporarily_unavailable", 503)
  try {
    return { tablesDB: createAdminServerClient().tablesDB, databaseId }
  } catch {
    throw new AdmissionError("service_temporarily_unavailable", 503)
  }
}

function params(bucket: Bucket) {
  return { databaseId: client().databaseId, tableId: "usage_counters", rowId: counterId(bucket) }
}

function event(name: string, resource: Resource, scope: string, category: string, status: number) {
  console.info(JSON.stringify({ event: name, resource, scope, category, status }))
}

// Stage a write BEFORE reading the value used for a decision. Plain read/compare/
// update can lose an intervening write before Appwrite captures its revision.
async function lock(bucket: Bucket, transactionId: string, amount: number) {
  const { tablesDB } = client()
  const base = params(bucket)
  try {
    await tablesDB.createRow({ ...base, permissions: [], data: { ...bucket, count: 0, leases: "[]" } })
  } catch (error) {
    if (!(error instanceof AppwriteException && error.code === 409)) throw error
  }
  await tablesDB.incrementRowColumn({ ...base, transactionId, column: "count", value: amount })
  return tablesDB.getRow<Counter>({ ...base, transactionId })
}

export async function admissionTransaction<T>(work: (transactionId: string) => Promise<T>): Promise<T> {
  const { tablesDB } = client()
  for (let attempt = 0; attempt < 8; attempt++) {
    const transaction = await tablesDB.createTransaction({ ttl: 60 }).catch(() => {
      throw new AdmissionError("service_temporarily_unavailable", 503)
    })
    let committing = false
    let result: T
    try {
      result = await work(transaction.$id)
      committing = true
      await tablesDB.updateTransaction({ transactionId: transaction.$id, commit: true })
      return result
    } catch (error) {
      // Never replay an ambiguously committed charge or compensation.
      if (committing) {
        const state = await tablesDB.getTransaction({ transactionId: transaction.$id }).catch(() => null)
        if (state?.status === "committed") {
          return result!
        }
        if (!state || !["failed", "rolled_back", "pending"].includes(state.status))
          throw new AdmissionError("service_temporarily_unavailable", 503)
      }
      await tablesDB.updateTransaction({ transactionId: transaction.$id, rollback: true }).catch(() => {})
      if (error instanceof AdmissionError) throw error
      // Preserve the caller's already-safe ownership/lifecycle error contract.
      if (error instanceof Error && "status" in error && typeof error.status === "number") throw error
      if (!(error instanceof AppwriteException && error.code === 409))
        throw new AdmissionError("service_temporarily_unavailable", 503)
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1) + Math.random() * 30))
    }
  }
  throw new AdmissionError("service_temporarily_unavailable", 503)
}

export async function stageAdmission(
  transactionId: string, userId: string, resource: Resource,
  { amount = 1, attachmentId, now = Date.now(), token = randomUUID() }: {
    amount?: number; attachmentId?: string; now?: number; token?: string
  } = {},
): Promise<Admission> {
  const config = requireAdmissionEnabled(resource)
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error("Invalid admission amount")
  const specs: ["user" | "global", "minute" | "day", number][] = resource === "chat_request"
    ? [["user", "minute", config.chatMinute], ["user", "day", config.chatDay], ["global", "day", config.globalChat]]
    : resource === "attachment_job"
      ? [["user", "day", config.attachmentDay], ["global", "day", config.globalAttachments]]
      : [["user", "day", config.attachmentBytes]]
  const charges: Charge[] = []
  for (const [scope, window, limit] of specs) {
    const bucket: Bucket = { scope, subjectId: scope === "user" ? userId : "global", resource, window, windowStart: utcWindow(window, now) }
    const row = await lock(bucket, transactionId, amount)
    if (row.count > limit) {
      const global = scope === "global"
      event(global ? "admission.global_denied" : "admission.denied", resource, scope, window, global ? 503 : 429)
      throw new AdmissionError(global ? "service_capacity_reached" : window === "minute" ? "rate_limit_exceeded" : "daily_limit_exceeded",
        global ? 503 : 429, global ? undefined : Math.max(1, Math.ceil((Date.parse(bucket.windowStart) + (window === "minute" ? 60000 : 86400000) - now) / 1000)))
    }
    charges.push({ bucket, amount })
  }
  if (resource === "attachment_bytes") return { charges, token }
  const bucket: Bucket = { scope: "user", subjectId: userId, resource, window: "lease", windowStart: "1970-01-01T00:00:00Z" }
  const row = await lock(bucket, transactionId, 1)
  const leases: Lease[] = JSON.parse(row.leases || "[]")
  const active: Lease[] = []
  for (const lease of leases) {
    if (lease.attachmentId) {
      try {
        // Read committed lifecycle state, not our newly staged requeue of this
        // same attachment. Terminal -> processing can only happen via admission
        // and therefore conflicts on the shared user lease row already locked.
        const attachment = await client().tablesDB.getRow({ databaseId: client().databaseId, tableId: "attachments", rowId: lease.attachmentId })
        if (attachment.status !== "processing") continue
        if (lease.expires > now) active.push(lease)
      } catch (error) {
        if (!(error instanceof AppwriteException && error.type === "row_not_found")) throw error
        // Deleting metadata does not cancel provider work already in flight.
        if (lease.expires > now) active.push(lease)
      }
    } else if (lease.expires > now) active.push(lease)
  }
  const limit = resource === "chat_request" ? config.chatConcurrent : config.attachmentConcurrent
  if (active.length >= limit) {
    event("admission.concurrency_denied", resource, "user", "concurrency", 429)
    throw new AdmissionError("concurrency_limit_exceeded", 429)
  }
  active.push({ token, expires: now + (resource === "chat_request" ? config.chatLeaseMs : config.attachmentLeaseMs + ATTACHMENT_LIMITS.leaseMs), ...(attachmentId ? { attachmentId } : {}) })
  await client().tablesDB.updateRow({ ...params(bucket), transactionId, data: { count: active.length, leases: JSON.stringify(active) } })
  return { charges, bucket, token }
}

export function logAdmissionAllowed(resource: Resource) {
  event("admission.allowed", resource, "user", "admission", 200)
}

export async function admit(userId: string, resource: Resource, amount = 1) {
  requireAdmissionEnabled(resource)
  const receipt = await admissionTransaction((id) => stageAdmission(id, userId, resource, { amount }))
  logAdmissionAllowed(resource)
  return receipt
}

export async function stageRelease(transactionId: string, receipt: Admission, compensate = false) {
  const { tablesDB } = client()
  if (receipt.bucket) {
    const row = await lock(receipt.bucket, transactionId, 1)
    const leases: Lease[] = JSON.parse(row.leases || "[]")
    if (!leases.some((lease) => lease.token === receipt.token)) {
      await tablesDB.updateRow({ ...params(receipt.bucket), transactionId, data: { count: leases.length } })
      return
    }
    const remaining = leases.filter((lease) => lease.token !== receipt.token)
    await tablesDB.updateRow({ ...params(receipt.bucket), transactionId, data: { count: remaining.length, leases: JSON.stringify(remaining) } })
  }
  if (compensate) for (const { bucket, amount } of receipt.charges)
    await tablesDB.decrementRowColumn({ ...params(bucket), transactionId, column: "count", value: amount, min: 0 })
}

export async function releaseAdmission(receipt: Admission, compensate = false) {
  await admissionTransaction((id) => stageRelease(id, receipt, compensate))
}

export function definitelyRejected(error: unknown) {
  // Network failures, timeouts and server errors may have accepted the operation.
  return error instanceof AppwriteException && [400, 401, 403, 404, 409, 413, 422, 429].includes(error.code)
}
