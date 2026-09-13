import { createCipheriv, randomBytes } from "node:crypto"

const iterations = 1_000
const plaintext = Buffer.alloc(24_000, "z")
const key = randomBytes(32)
const aad = Buffer.from('["zenote","content","v1","benchmark","message","row","content",1]')
const started = performance.now()
for (let index = 0; index < iterations; index++) {
  const cipher = createCipheriv("aes-256-gcm", key, randomBytes(12))
  cipher.setAAD(aad)
  cipher.update(plaintext)
  cipher.final()
  cipher.getAuthTag()
}
const elapsedMs = performance.now() - started
key.fill(0)
console.info(JSON.stringify({ iterations, bytesPerOperation: plaintext.length, elapsedMs: Number(elapsedMs.toFixed(2)), operationsPerSecond: Number((iterations / (elapsedMs / 1_000)).toFixed(2)) }))
