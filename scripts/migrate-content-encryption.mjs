import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms"
import { Client, Query, TablesDB } from "node-appwrite"

const mode = process.argv.slice(2).find((arg) => ["--dry-run", "--apply", "--verify"].includes(arg))
if (!mode || process.argv.length !== 3) {
  throw new Error("Usage: pnpm migrate:content-encryption -- --dry-run|--apply|--verify")
}

const databaseId = process.env.APPWRITE_DATABASE_ID
const apiKey = process.env.APPWRITE_PROVISIONING_API_KEY || process.env.APPWRITE_API_KEY
const keyArn = process.env.ZENOTE_KMS_KEY_ARN
const keyVersion = Number(process.env.ZENOTE_CRYPTO_ACTIVE_KEY_VERSION)
if (!databaseId || !apiKey || !keyArn || !Number.isInteger(keyVersion) || keyVersion < 1)
  throw new Error("APPWRITE_DATABASE_ID, an admin Appwrite key, ZENOTE_KMS_KEY_ARN, and ZENOTE_CRYPTO_ACTIVE_KEY_VERSION are required.")

const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || "https://sgp.cloud.appwrite.io/v1")
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID || "6a9e3f7c0019355433ad")
  .setKey(apiKey)
const tablesDB = new TablesDB(client)
const kms = new KMSClient({ region: "us-east-1" })
const dekCache = new Map()
function clearDekCache() { for (const dek of dekCache.values()) dek.fill(0); dekCache.clear() }
process.once("exit", clearDekCache)
const encrypted = (value) => value.startsWith("zenc:")
const keyRowId = (userId, version) => createHash("sha256").update(`${userId}:${version}`).digest("hex").slice(0, 36)
const context = (userId, version) => ({ application: "zenote", purpose: "content-encryption", userId, keyVersion: String(version) })
const aad = (userId, entityType, rowId, fieldName, version) => Buffer.from(JSON.stringify(["zenote", "content", "v1", userId, entityType, rowId, fieldName, version]))

async function dekFor(userId, version = keyVersion) {
  const cacheId = `${userId}:${version}`
  const cached = dekCache.get(cacheId)
  if (cached) return Buffer.from(cached)
  const rowId = keyRowId(userId, version)
  let row
  try {
    row = await tablesDB.getRow({ databaseId, tableId: "user_crypto_keys", rowId })
  } catch (error) {
    if (error.code !== 404) throw error
  }
  if (!row) {
    const generated = await kms.send(new GenerateDataKeyCommand({ KeyId: keyArn, KeySpec: "AES_256", EncryptionContext: context(userId, version) }))
    if (!generated.Plaintext || !generated.CiphertextBlob || generated.Plaintext.length !== 32)
      throw new Error(`KMS did not return a valid DEK for user ${userId}.`)
    try {
      await tablesDB.createRow({ databaseId, tableId: "user_crypto_keys", rowId, permissions: [], data: { userId, keyVersion: version, wrappedDek: Buffer.from(generated.CiphertextBlob).toString("base64url"), kmsKeyArn: keyArn, algorithm: "AES-256-GCM" } })
      const dek = Buffer.from(generated.Plaintext)
      dekCache.set(cacheId, Buffer.from(dek))
      return dek
    } catch (error) {
      if (error.code !== 409) throw error
      row = await tablesDB.getRow({ databaseId, tableId: "user_crypto_keys", rowId })
    } finally {
      generated.Plaintext.fill(0)
    }
  }
  if (row.userId !== userId || row.keyVersion !== version || !row.kmsKeyArn || row.algorithm !== "AES-256-GCM" || !row.wrappedDek)
    throw new Error(`Invalid crypto key row for user ${userId}.`)
  const result = await kms.send(new DecryptCommand({ KeyId: row.kmsKeyArn, CiphertextBlob: Buffer.from(row.wrappedDek, "base64url"), EncryptionContext: context(userId, version) }))
  if (!result.Plaintext || result.Plaintext.length !== 32) throw new Error(`KMS could not unwrap a valid DEK for user ${userId}.`)
  const dek = Buffer.from(result.Plaintext)
  result.Plaintext.fill(0)
  dekCache.set(cacheId, Buffer.from(dek))
  return dek
}

async function encrypt(userId, entityType, rowId, fieldName, plaintext) {
  const dek = await dekFor(userId, keyVersion)
  try {
    const nonce = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", dek, nonce)
    cipher.setAAD(aad(userId, entityType, rowId, fieldName, keyVersion))
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
    return `zenc:v1:${keyVersion}:${nonce.toString("base64url")}:${ciphertext.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}`
  } finally {
    dek.fill(0)
  }
}

async function decrypt(userId, entityType, rowId, fieldName, value) {
  const parts = value.split(":")
  if (parts.length !== 6 || parts[0] !== "zenc" || parts[1] !== "v1" || !/^[1-9][0-9]*$/.test(parts[2]))
    throw new Error(`Malformed envelope at ${entityType}/${rowId}/${fieldName}.`)
  const version = Number(parts[2])
  if (!Number.isSafeInteger(version)) throw new Error(`Invalid envelope at ${entityType}/${rowId}/${fieldName}.`)
  const dek = await dekFor(userId, version)
  try {
    const nonce = Buffer.from(parts[3], "base64url"), ciphertext = Buffer.from(parts[4], "base64url"), tag = Buffer.from(parts[5], "base64url")
    if (nonce.length !== 12 || tag.length !== 16 || ![parts[3], parts[4], parts[5]].every((part) => Buffer.from(part, "base64url").toString("base64url") === part))
      throw new Error(`Invalid envelope at ${entityType}/${rowId}/${fieldName}.`)
    const decipher = createDecipheriv("aes-256-gcm", dek, nonce)
    decipher.setAAD(aad(userId, entityType, rowId, fieldName, version))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
  } finally {
    dek.fill(0)
  }
}

const targets = [
  { tableId: "messages", entityType: "message", fieldName: "content" },
  { tableId: "attachments", entityType: "attachment", fieldName: "processedText" },
  { tableId: "conversations", entityType: "conversation", fieldName: "title" },
  { tableId: "conversations", entityType: "conversation", fieldName: "systemPrompt" },
  { tableId: "user_preferences", entityType: "user_preference", fieldName: "customInstructions" },
]

let total = 0
for (const target of targets) {
  let cursor
  for (;;) {
    const { rows } = await tablesDB.listRows({ databaseId, tableId: target.tableId, total: false, queries: [Query.orderAsc("$id"), Query.limit(100), ...(cursor ? [Query.cursorAfter(cursor)] : [])] })
    for (const row of rows) {
      const value = row[target.fieldName]
      if (value == null) continue
      if (typeof value !== "string") throw new Error(`Non-string protected field at ${target.tableId}/${row.$id}.`)
      if (mode === "--verify") {
        if (!encrypted(value)) throw new Error(`Unencrypted value at ${target.tableId}/${row.$id}/${target.fieldName}.`)
        await decrypt(row.userId, target.entityType, row.$id, target.fieldName, value)
      } else if (!encrypted(value)) {
        total++
        if (mode === "--apply")
          await tablesDB.updateRow({ databaseId, tableId: target.tableId, rowId: row.$id, data: { [target.fieldName]: await encrypt(row.userId, target.entityType, row.$id, target.fieldName, value) } })
      }
    }
    if (rows.length < 100) break
    cursor = rows.at(-1).$id
  }
}
clearDekCache()
console.info(`${mode.slice(2)} complete: ${mode === "--verify" ? "all protected values decrypted successfully" : `${total} values ${mode === "--apply" ? "encrypted" : "would be encrypted"}`}.`)
