import "server-only"

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms"
import { AppwriteException, type Models } from "node-appwrite"
import { createAdminServerClient } from "@/lib/appwrite-server"

export type ContentLocation = {
  userId: string
  entityType: "message" | "conversation" | "attachment" | "user_preference"
  rowId: string
  fieldName: "content" | "title" | "systemPrompt" | "processedText" | "customInstructions"
}

type KeyRow = Models.Row & {
  userId: string
  keyVersion: number
  wrappedDek: string
  kmsKeyArn: string
  algorithm: string
}
type CachedKey = { value: Buffer; expiresAt: number }

export class ContentCryptoError extends Error {
  constructor(public readonly code: "crypto_configuration_error" | "crypto_key_error" | "crypto_encrypt_error" | "crypto_decrypt_error" | "crypto_format_error") {
    super("Protected content is temporarily unavailable.")
  }
}

const cache = new Map<string, CachedKey>()
const kms = new KMSClient({ region: "us-east-1" })

function config() {
  const keyArn = process.env.ZENOTE_KMS_KEY_ARN
  const version = Number(process.env.ZENOTE_CRYPTO_ACTIVE_KEY_VERSION)
  const legacy = process.env.ZENOTE_CRYPTO_ALLOW_LEGACY_PLAINTEXT
  const ttl = Number(process.env.ZENOTE_CRYPTO_DEK_CACHE_TTL_SECONDS || "300")
  const max = Number(process.env.ZENOTE_CRYPTO_DEK_CACHE_MAX_ENTRIES || "256")
  if (!keyArn || !Number.isInteger(version) || version < 1 || !Number.isInteger(ttl) || ttl < 1 || !Number.isInteger(max) || max < 1)
    throw new ContentCryptoError("crypto_configuration_error")
  if (process.env.NODE_ENV === "production" && legacy !== "true" && legacy !== "false")
    throw new ContentCryptoError("crypto_configuration_error")
  return { keyArn, version, legacy: legacy === "true", ttlMs: ttl * 1000, max }
}

export function userCryptoKeyRowId(userId: string, keyVersion: number) {
  return createHash("sha256").update(`${userId}:${keyVersion}`).digest("hex").slice(0, 36)
}

export function encryptionContext(userId: string, keyVersion: number) {
  return { application: "zenote", purpose: "content-encryption", userId, keyVersion: String(keyVersion) }
}

export function contentAad(location: ContentLocation, keyVersion: number) {
  return Buffer.from(JSON.stringify(["zenote", "content", "v1", location.userId, location.entityType, location.rowId, location.fieldName, keyVersion]))
}

function cacheKey(userId: string, keyVersion: number) { return `${userId}:${keyVersion}` }
function putCache(userId: string, keyVersion: number, value: Buffer, ttlMs: number, max: number) {
  while (cache.size >= max) {
    const first = cache.entries().next().value as [string, CachedKey] | undefined
    if (!first) break
    first[1].value.fill(0); cache.delete(first[0])
  }
  cache.set(cacheKey(userId, keyVersion), { value: Buffer.from(value), expiresAt: Date.now() + ttlMs })
}

function getCache(userId: string, keyVersion: number) {
  const found = cache.get(cacheKey(userId, keyVersion))
  if (!found) return null
  if (found.expiresAt <= Date.now()) { found.value.fill(0); cache.delete(cacheKey(userId, keyVersion)); return null }
  return Buffer.from(found.value)
}

async function loadOrCreateDek(userId: string, keyVersion: number) {
  const cfg = config(); const cached = getCache(userId, keyVersion); if (cached) return cached
  const { tablesDB } = createAdminServerClient(); const databaseId = process.env.APPWRITE_DATABASE_ID
  if (!databaseId) throw new ContentCryptoError("crypto_configuration_error")
  const rowId = userCryptoKeyRowId(userId, keyVersion)
  let row: KeyRow | null = null
  try { row = await tablesDB.getRow<KeyRow>({ databaseId, tableId: "user_crypto_keys", rowId }) } catch (error) {
    if (!(error instanceof AppwriteException && error.code === 404)) throw new ContentCryptoError("crypto_key_error")
  }
  if (!row) {
    let generated: { Plaintext?: Uint8Array; CiphertextBlob?: Uint8Array }
    try { generated = await kms.send(new GenerateDataKeyCommand({ KeyId: cfg.keyArn, KeySpec: "AES_256", EncryptionContext: encryptionContext(userId, keyVersion) })) }
    catch { throw new ContentCryptoError("crypto_key_error") }
    if (!generated.Plaintext || !generated.CiphertextBlob || generated.Plaintext.length !== 32) throw new ContentCryptoError("crypto_key_error")
    try {
      row = await tablesDB.createRow<KeyRow>({ databaseId, tableId: "user_crypto_keys", rowId, permissions: [], data: { userId, keyVersion, wrappedDek: Buffer.from(generated.CiphertextBlob).toString("base64url"), kmsKeyArn: cfg.keyArn, algorithm: "AES-256-GCM" } })
      const dek = Buffer.from(generated.Plaintext); putCache(userId, keyVersion, dek, cfg.ttlMs, cfg.max); return dek
    } catch (error) {
      if (!(error instanceof AppwriteException && error.code === 409)) throw new ContentCryptoError("crypto_key_error")
      try { row = await tablesDB.getRow<KeyRow>({ databaseId, tableId: "user_crypto_keys", rowId }) } catch { throw new ContentCryptoError("crypto_key_error") }
    } finally { generated.Plaintext?.fill(0) }
  }
  if (!row || row.userId !== userId || row.keyVersion !== keyVersion || !row.kmsKeyArn || row.algorithm !== "AES-256-GCM" || !row.wrappedDek) throw new ContentCryptoError("crypto_key_error")
  let plaintext: Uint8Array | undefined
  try { plaintext = (await kms.send(new DecryptCommand({ KeyId: row.kmsKeyArn, CiphertextBlob: Buffer.from(row.wrappedDek, "base64url"), EncryptionContext: encryptionContext(userId, keyVersion) }))).Plaintext }
  catch { throw new ContentCryptoError("crypto_key_error") }
  if (!plaintext || plaintext.length !== 32) throw new ContentCryptoError("crypto_key_error")
  try { const dek = Buffer.from(plaintext); putCache(userId, keyVersion, dek, cfg.ttlMs, cfg.max); return dek }
  finally { plaintext.fill(0) }
}

function parseEnvelope(value: string) {
  const parts = value.split(":")
  if (parts.length !== 6 || parts[0] !== "zenc" || parts[1] !== "v1" || !/^[1-9][0-9]*$/.test(parts[2]!)) throw new ContentCryptoError("crypto_format_error")
  try {
    const nonce = Buffer.from(parts[3]!, "base64url"), ciphertext = Buffer.from(parts[4]!, "base64url"), tag = Buffer.from(parts[5]!, "base64url")
    if (nonce.length !== 12 || tag.length !== 16 || ![parts[3], parts[4], parts[5]].every((part) => Buffer.from(part!, "base64url").toString("base64url") === part)) throw new Error()
    const keyVersion = Number(parts[2])
    if (!Number.isSafeInteger(keyVersion)) throw new Error()
    return { keyVersion, nonce, ciphertext, tag }
  } catch { throw new ContentCryptoError("crypto_format_error") }
}

export function isEncryptedContent(value: string) { return typeof value === "string" && value.startsWith("zenc:") }

export async function encryptContent(location: ContentLocation, plaintext: string) {
  let dek: Buffer | undefined
  try {
    const { version } = config(); dek = await loadOrCreateDek(location.userId, version); const nonce = randomBytes(12)
    const cipher = createCipheriv("aes-256-gcm", dek, nonce); cipher.setAAD(contentAad(location, version)); const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]); const tag = cipher.getAuthTag()
    return `zenc:v1:${version}:${nonce.toString("base64url")}:${ciphertext.toString("base64url")}:${tag.toString("base64url")}`
  } catch (error) { if (error instanceof ContentCryptoError) throw error; throw new ContentCryptoError("crypto_encrypt_error") }
  finally { dek?.fill(0) }
}

export async function decryptContent(location: ContentLocation, value: string) {
  if (typeof value !== "string") throw new ContentCryptoError("crypto_format_error")
  if (!isEncryptedContent(value)) { if (config().legacy) return value; throw new ContentCryptoError("crypto_format_error") }
  const envelope = parseEnvelope(value)
  let dek: Buffer | undefined
  try { dek = await loadOrCreateDek(location.userId, envelope.keyVersion); const decipher = createDecipheriv("aes-256-gcm", dek, envelope.nonce); decipher.setAAD(contentAad(location, envelope.keyVersion)); decipher.setAuthTag(envelope.tag); return Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]).toString("utf8") }
  catch (error) { if (error instanceof ContentCryptoError) throw error; throw new ContentCryptoError("crypto_decrypt_error") }
  finally { dek?.fill(0) }
}

export function __clearContentCryptoCacheForTests() { for (const entry of cache.values()) entry.value.fill(0); cache.clear() }
