import { createCipheriv, createHash, randomBytes } from "node:crypto"
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms"
import type { TablesDB } from "node-appwrite"

export type CryptoTables = Pick<TablesDB, "getRow" | "createRow">

type KeyRow = {
  userId: string
  keyVersion: number
  wrappedDek: string
  kmsKeyArn: string
  algorithm: string
}

type CachedKey = { value: Buffer; expiresAt: number }

export class ContentCryptoError extends Error {
  constructor(public readonly code: "crypto_configuration_error" | "crypto_key_error" | "crypto_encrypt_error") {
    super("Protected content is temporarily unavailable.")
  }
}

const cache = new Map<string, CachedKey>()
const kms = new KMSClient({ region: "us-east-1" })

function config() {
  const keyArn = process.env.ZENOTE_KMS_KEY_ARN
  const version = Number(process.env.ZENOTE_CRYPTO_ACTIVE_KEY_VERSION)
  const ttl = Number(process.env.ZENOTE_CRYPTO_DEK_CACHE_TTL_SECONDS || "300")
  const max = Number(process.env.ZENOTE_CRYPTO_DEK_CACHE_MAX_ENTRIES || "256")
  if (!keyArn || !Number.isInteger(version) || version < 1 || !Number.isInteger(ttl) || ttl < 1 || !Number.isInteger(max) || max < 1)
    throw new ContentCryptoError("crypto_configuration_error")
  return { keyArn, version, ttlMs: ttl * 1000, max }
}

export function userCryptoKeyRowId(userId: string, keyVersion: number) {
  return createHash("sha256").update(`${userId}:${keyVersion}`).digest("hex").slice(0, 36)
}

export function encryptionContext(userId: string, keyVersion: number) {
  return { application: "zenote", purpose: "content-encryption", userId, keyVersion: String(keyVersion) }
}

export function contentAad(userId: string, rowId: string, keyVersion: number) {
  return Buffer.from(JSON.stringify(["zenote", "content", "v1", userId, "attachment", rowId, "processedText", keyVersion]))
}

function cacheKey(userId: string, keyVersion: number) {
  return `${userId}:${keyVersion}`
}

function putCache(userId: string, keyVersion: number, value: Buffer, ttlMs: number, max: number) {
  while (cache.size >= max) {
    const first = cache.entries().next().value as [string, CachedKey] | undefined
    if (!first) break
    first[1].value.fill(0)
    cache.delete(first[0])
  }
  cache.set(cacheKey(userId, keyVersion), { value: Buffer.from(value), expiresAt: Date.now() + ttlMs })
}

function getCache(userId: string, keyVersion: number) {
  const found = cache.get(cacheKey(userId, keyVersion))
  if (!found) return null
  if (found.expiresAt <= Date.now()) {
    found.value.fill(0)
    cache.delete(cacheKey(userId, keyVersion))
    return null
  }
  return Buffer.from(found.value)
}

async function loadOrCreateDek(tablesDB: CryptoTables, databaseId: string, userId: string, keyVersion: number) {
  const cfg = config()
  const cached = getCache(userId, keyVersion)
  if (cached) return cached
  const rowId = userCryptoKeyRowId(userId, keyVersion)
  let row: KeyRow | null = null
  try {
    row = await tablesDB.getRow({ databaseId, tableId: "user_crypto_keys", rowId }) as unknown as KeyRow
  } catch (error: unknown) {
    if (!(typeof error === "object" && error && "code" in error && error.code === 404))
      throw new ContentCryptoError("crypto_key_error")
  }
  if (!row) {
    let generated: { Plaintext?: Uint8Array; CiphertextBlob?: Uint8Array }
    try {
      generated = await kms.send(new GenerateDataKeyCommand({ KeyId: cfg.keyArn, KeySpec: "AES_256", EncryptionContext: encryptionContext(userId, keyVersion) }))
    } catch {
      throw new ContentCryptoError("crypto_key_error")
    }
    if (!generated.Plaintext || !generated.CiphertextBlob || generated.Plaintext.length !== 32)
      throw new ContentCryptoError("crypto_key_error")
    try {
      await tablesDB.createRow({ databaseId, tableId: "user_crypto_keys", rowId, permissions: [], data: { userId, keyVersion, wrappedDek: Buffer.from(generated.CiphertextBlob).toString("base64url"), kmsKeyArn: cfg.keyArn, algorithm: "AES-256-GCM" } })
      const dek = Buffer.from(generated.Plaintext)
      putCache(userId, keyVersion, dek, cfg.ttlMs, cfg.max)
      return dek
    } catch (error: unknown) {
      if (!(typeof error === "object" && error && "code" in error && error.code === 409))
        throw new ContentCryptoError("crypto_key_error")
      try {
        row = await tablesDB.getRow({ databaseId, tableId: "user_crypto_keys", rowId }) as unknown as KeyRow
      } catch {
        throw new ContentCryptoError("crypto_key_error")
      }
    } finally {
      generated.Plaintext.fill(0)
    }
  }
  if (!row || row.userId !== userId || row.keyVersion !== keyVersion || !row.kmsKeyArn || row.algorithm !== "AES-256-GCM" || !row.wrappedDek)
    throw new ContentCryptoError("crypto_key_error")
  let plaintext: Uint8Array | undefined
  try {
    plaintext = (await kms.send(new DecryptCommand({ KeyId: row.kmsKeyArn, CiphertextBlob: Buffer.from(row.wrappedDek, "base64url"), EncryptionContext: encryptionContext(userId, keyVersion) }))).Plaintext
  } catch {
    throw new ContentCryptoError("crypto_key_error")
  }
  if (!plaintext || plaintext.length !== 32) throw new ContentCryptoError("crypto_key_error")
  try {
    const dek = Buffer.from(plaintext)
    putCache(userId, keyVersion, dek, cfg.ttlMs, cfg.max)
    return dek
  } finally {
    plaintext.fill(0)
  }
}

export async function encryptAttachmentText(tablesDB: CryptoTables, databaseId: string, userId: string, attachmentId: string, plaintext: string) {
  try {
    const { version } = config()
    const dek = await loadOrCreateDek(tablesDB, databaseId, userId, version)
    try {
      const nonce = randomBytes(12)
      const cipher = createCipheriv("aes-256-gcm", dek, nonce)
      cipher.setAAD(contentAad(userId, attachmentId, version))
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
      return `zenc:v1:${version}:${nonce.toString("base64url")}:${ciphertext.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}`
    } finally {
      dek.fill(0)
    }
  } catch (error) {
    if (error instanceof ContentCryptoError) throw error
    throw new ContentCryptoError("crypto_encrypt_error")
  }
}

export function __clearContentCryptoCacheForTests() {
  for (const entry of cache.values()) entry.value.fill(0)
  cache.clear()
}
