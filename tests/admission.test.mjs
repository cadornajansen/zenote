import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { beforeEach, test } from "node:test"
import ts from "typescript"
import { AppwriteException } from "node-appwrite"
import { admissionStore } from "./admission-store.mjs"

let store
globalThis.__admissionAdmin = () => store
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }
    if (specifier === "@/lib/appwrite-server") return { url: "data:text/javascript,export const createAdminServerClient=()=>globalThis.__admissionAdmin()", shortCircuit: true }
    if (specifier.startsWith("@/")) return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith(".ts")) return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText }
    return next(url, context)
  },
})
const a = await import("../lib/admission.ts")
const now = Date.parse("2026-09-10T23:59:30Z")
const start = (user = "owner", resource = "chat_request", options = {}) => a.admissionTransaction((id) => a.stageAdmission(id, user, resource, { now, ...options }))
beforeEach(() => {
  store = admissionStore()
  process.env.APPWRITE_DATABASE_ID = "test"
  for (const key of Object.keys(process.env)) if (key.startsWith("ZENOTE_")) delete process.env[key]
})

test("first, exact limit, over limit; denial rolls back every bucket", async () => {
  process.env.ZENOTE_CHAT_PER_MINUTE = "2"
  await start()
  await start()
  await assert.rejects(start(), { code: "rate_limit_exceeded", status: 429, retryAfter: 30 })
  assert.deepEqual(store.counters().map((row) => row.count), [2, 2, 2])
})
test("minute rollover and daily rollover use canonical UTC keys", async () => {
  process.env.ZENOTE_CHAT_PER_MINUTE = "1"
  process.env.ZENOTE_CHAT_PER_DAY = "2"
  const first = await start("owner", "chat_request", { now: now - 60000 })
  await a.releaseAdmission(first)
  const second = await start()
  await a.releaseAdmission(second)
  await assert.rejects(start("owner", "chat_request", { now: now - 120000 }), { code: "daily_limit_exceeded" })
  await start("owner", "chat_request", { now: now + 60000 })
  assert.equal(a.utcWindow("minute", now), "2026-09-10T23:59:00Z")
  assert.equal(a.utcWindow("day", now), "2026-09-10T00:00:00Z")
})
test("users are independent but share the global ceiling", async () => {
  process.env.ZENOTE_GLOBAL_CHAT_PER_DAY = "2"
  await start("one")
  await start("two")
  await assert.rejects(start("three"), { code: "service_capacity_reached", status: 503, retryAfter: undefined })
  assert.equal(store.counters().find((r) => r.scope === "global").count, 2)
  assert.ok(store.counters().filter((r) => r.subjectId === "three").every((r) => r.count === 0))
})
test("chat concurrency release is idempotent and lease expiry recovers crashes", async () => {
  const first = await start()
  await start()
  await assert.rejects(start(), { code: "concurrency_limit_exceeded" })
  await a.releaseAdmission(first)
  await a.releaseAdmission(first)
  await start()
  await start("owner", "chat_request", { now: now + 300000 })
  assert.equal(JSON.parse(store.leases()[0].leases).length, 1)
})
test("Promise.all competing admissions cannot exceed user quota", async () => {
  process.env.ZENOTE_CHAT_PER_MINUTE = "3"
  process.env.ZENOTE_CHAT_MAX_CONCURRENT = "100"
  const results = await Promise.allSettled(Array.from({ length: 30 }, () => start()))
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 3)
  assert.deepEqual(store.counters().map((r) => r.count), [3, 3, 3])
})
test("Promise.all across users cannot exceed global quota", async () => {
  process.env.ZENOTE_GLOBAL_CHAT_PER_DAY = "3"
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => start(`user${i}`)))
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 3)
  assert.equal(store.counters().find((r) => r.scope === "global").count, 3)
})
test("Promise.all cannot exceed concurrent leases and rolls back rejected quotas", async () => {
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => start()))
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2)
  assert.deepEqual(store.counters().map((r) => r.count), [2, 2, 2])
})
test("attachment bytes use amount and compensate a rejected persistence", async () => {
  process.env.ZENOTE_ATTACHMENT_BYTES_PER_DAY = "10"
  const receipt = await start("owner", "attachment_bytes", { amount: 10 })
  await assert.rejects(start("owner", "attachment_bytes"), { code: "daily_limit_exceeded" })
  await a.releaseAdmission(receipt, true)
  await start("owner", "attachment_bytes", { amount: 10 })
  assert.equal(store.counters()[0].count, 10)
})
test("attachment concurrency reconciles existing terminal statuses without Function callback", async () => {
  process.env.ZENOTE_ATTACHMENTS_MAX_CONCURRENT = "1"
  const p = { databaseId: "test", tableId: "attachments", rowId: "file" }
  await store.tablesDB.createRow({ ...p, data: { status: "processing" } })
  await start("owner", "attachment_job", { attachmentId: "file" })
  await assert.rejects(start("owner", "attachment_job", { attachmentId: "other" }), { code: "concurrency_limit_exceeded" })
  await store.tablesDB.updateRow({ ...p, data: { status: "failed" } })
  await start("owner", "attachment_job", { attachmentId: "other" })
  assert.deepEqual(store.counters().map((r) => r.count), [2, 2])
})
test("requeue sees the completed old attempt, not its own staged processing status", async () => {
  process.env.ZENOTE_ATTACHMENTS_MAX_CONCURRENT = "1"
  const p = { tableId: "attachments", rowId: "file" }
  await store.tablesDB.createRow({ ...p, data: { status: "processing" } })
  await start("owner", "attachment_job", { attachmentId: "file" })
  await store.tablesDB.updateRow({ ...p, data: { status: "failed" } })
  await a.admissionTransaction(async (id) => {
    await store.tablesDB.updateRow({ ...p, transactionId: id, data: { status: "processing" } })
    return a.stageAdmission(id, "owner", "attachment_job", { now, attachmentId: "file" })
  })
  assert.equal(store.leases()[0].count, 1)
  assert.deepEqual(store.counters().map((r) => r.count), [2, 2])
})
test("job compensation is atomic and token-idempotent", async () => {
  const receipt = await start("owner", "attachment_job")
  await a.releaseAdmission(receipt, true)
  await a.releaseAdmission(receipt, true)
  assert.deepEqual(store.counters().map((r) => r.count), [0, 0])
})
test("attachment concurrency holds deleted work until deadline plus processing grace", async () => {
  process.env.ZENOTE_ATTACHMENTS_MAX_CONCURRENT = "1"
  await start("owner", "attachment_job", { attachmentId: "deleted" })
  await assert.rejects(start("owner", "attachment_job", { now: now + 360000 }), { code: "concurrency_limit_exceeded" })
  await start("owner", "attachment_job", { now: now + 720000 })
})
test("simultaneous attachment reservations serialize across different attachment rows", async () => {
  process.env.ZENOTE_ATTACHMENTS_MAX_CONCURRENT = "2"
  const results = await Promise.allSettled(Array.from({ length: 15 }, (_, i) =>
    a.admissionTransaction(async (id) => {
      const attachmentId = `file${i}`
      await store.tablesDB.createRow({ tableId: "attachments", rowId: attachmentId, transactionId: id, data: { status: "processing" } })
      return a.stageAdmission(id, "owner", "attachment_job", { now, attachmentId })
    })
  ))
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2)
  assert.equal([...store.rows.keys()].filter((key) => key.startsWith("attachments/")).length, 2)
  assert.deepEqual(store.counters().map((r) => r.count), [2, 2])
})
test("kill switches and invalid configuration fail closed before counters", async () => {
  process.env.ZENOTE_CHAT_ENABLED = "false"
  await assert.rejects(a.admit("owner", "chat_request"), { code: "service_temporarily_unavailable", status: 503 })
  process.env.ZENOTE_ATTACHMENTS_ENABLED = "false"
  await assert.rejects(a.admit("owner", "attachment_bytes", 5), { code: "service_temporarily_unavailable" })
  assert.equal(store.rows.size, 0)
  assert.throws(() => a.admissionConfig({ ZENOTE_CHAT_PER_DAY: "NaN" }))
  assert.throws(() => a.admissionConfig({ ZENOTE_CHAT_ENABLED: "yes" }))
  assert.throws(() => a.admissionConfig({ ZENOTE_CHAT_LEASE_SECONDS: "1" }))
})
test("lost successful commit response resolves without charging twice", async () => {
  const update = store.tablesDB.updateTransaction
  let lost = false
  store.tablesDB.updateTransaction = async (p) => {
    await update(p)
    if (p.commit && !lost) { lost = true; throw new TypeError("fetch failed") }
  }
  await start()
  assert.deepEqual(store.counters().map((r) => r.count), [1, 1, 1])
})
test("compensation retries a transaction conflict without double refund", async () => {
  const receipt = await start("owner", "attachment_job")
  const update = store.tablesDB.updateTransaction
  let conflict = true
  store.tablesDB.updateTransaction = async (p) => {
    if (p.commit && conflict) {
      conflict = false
      throw new AppwriteException("Conflict", 409)
    }
    return update(p)
  }
  await a.releaseAdmission(receipt, true)
  assert.deepEqual(store.counters().map((r) => r.count), [0, 0])
  assert.equal(store.leases()[0].count, 0)
})
test("transaction outage fails closed and typed ownership errors stay intact", async () => {
  const error = Object.assign(new Error("Attachment not found."), { status: 404 })
  await assert.rejects(a.admissionTransaction(async () => { throw error }), (caught) => caught === error)
  store.tablesDB.createTransaction = async () => { throw new Error("private configuration") }
  await assert.rejects(a.admit("owner", "chat_request"), { code: "service_temporarily_unavailable", status: 503 })
  assert.equal(store.rows.size, 0)
})
