import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { afterEach, test } from "node:test"
import { AppwriteException } from "node-appwrite"
import ts from "typescript"

const rows = new Map()
const wrapped = new Map()
const calls = []

globalThis.__cryptoAdmin = () => ({
  tablesDB: {
    async getRow({ rowId }) {
      const row = rows.get(rowId)
      if (!row) throw new AppwriteException("missing", 404)
      return row
    },
    async createRow({ rowId, data }) {
      if (rows.has(rowId)) throw { code: 409 }
      const row = { $id: rowId, ...data }
      rows.set(rowId, row)
      return row
    },
  },
})

const kmsModule = `
export class GenerateDataKeyCommand { constructor(input) { this.input = input } }
export class DecryptCommand { constructor(input) { this.input = input } }
export class KMSClient {
  async send(command) {
    globalThis.__cryptoCalls.push(command.input)
    if (command.input.KeySpec) {
      const plaintext = Buffer.from(globalThis.__cryptoHash(command.input.EncryptionContext), "hex")
      const ciphertext = Buffer.from("wrapped-" + plaintext.toString("hex"))
      globalThis.__cryptoWrapped.set(ciphertext.toString("base64url"), Buffer.from(plaintext))
      return { Plaintext: plaintext, CiphertextBlob: ciphertext }
    }
    const plaintext = globalThis.__cryptoWrapped.get(Buffer.from(command.input.CiphertextBlob).toString("base64url"))
    return { Plaintext: plaintext }
  }
}
`
globalThis.__cryptoCalls = calls
globalThis.__cryptoWrapped = wrapped
globalThis.__cryptoHash = (context) => createHash("sha256").update(JSON.stringify(context)).digest().subarray(0, 32)

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true }
    if (specifier === "@aws-sdk/client-kms") return { url: `data:text/javascript,${encodeURIComponent(kmsModule)}`, shortCircuit: true }
    if (specifier === "@/lib/appwrite-server") return { url: "data:text/javascript,export const createAdminServerClient=()=>globalThis.__cryptoAdmin()", shortCircuit: true }
    if (specifier.startsWith("@/")) return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith(".ts")) return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText }
    return next(url, context)
  },
})

const site = await import("../lib/content-crypto.ts")
const processor = await import("../functions/attachment-processor/src/content-crypto.ts")

afterEach(() => {
  rows.clear(); wrapped.clear(); calls.length = 0
  site.__clearContentCryptoCacheForTests()
  processor.__clearContentCryptoCacheForTests()
})

test("Site decrypts the independently generated Function envelope", async () => {
  process.env.APPWRITE_DATABASE_ID = "database"
  process.env.ZENOTE_KMS_KEY_ARN = "arn:aws:kms:us-east-1:123456789012:key/current"
  process.env.ZENOTE_CRYPTO_ACTIVE_KEY_VERSION = "1"
  process.env.ZENOTE_CRYPTO_ALLOW_LEGACY_PLAINTEXT = "false"

  const ciphertext = await processor.encryptAttachmentText(globalThis.__cryptoAdmin().tablesDB, "database", "user", "attachment", "extracted text")
  assert.match(ciphertext, /^zenc:v1:1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]*:[A-Za-z0-9_-]{22}$/)
  assert.equal(await site.decryptContent({ userId: "user", entityType: "attachment", rowId: "attachment", fieldName: "processedText" }, ciphertext), "extracted text")
  assert.deepEqual(calls[0].EncryptionContext, { application: "zenote", purpose: "content-encryption", userId: "user", keyVersion: "1" })
})

test("envelope authentication fails when its bound field changes", async () => {
  process.env.APPWRITE_DATABASE_ID = "database"
  process.env.ZENOTE_KMS_KEY_ARN = "arn:aws:kms:us-east-1:123456789012:key/current"
  process.env.ZENOTE_CRYPTO_ACTIVE_KEY_VERSION = "1"
  process.env.ZENOTE_CRYPTO_ALLOW_LEGACY_PLAINTEXT = "false"

  const ciphertext = await site.encryptContent({ userId: "user", entityType: "message", rowId: "message", fieldName: "content" }, "private")
  await assert.rejects(site.decryptContent({ userId: "user", entityType: "message", rowId: "message", fieldName: "content" }, `${ciphertext}:extra`))
  await assert.rejects(site.decryptContent({ userId: "user", entityType: "conversation", rowId: "message", fieldName: "title" }, ciphertext))
})
