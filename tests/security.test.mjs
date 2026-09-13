import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { afterEach, test } from "node:test"
import ts from "typescript"

let forwardedRequestHeaders
globalThis.__securityNextResponse = (options) => {
  forwardedRequestHeaders = options.request.headers
  return new Response(null)
}

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only")
      return { url: "data:text/javascript,export {}", shortCircuit: true }
    if (specifier === "next/server")
      return {
        url: "data:text/javascript,export class NextResponse { static next(options){return globalThis.__securityNextResponse(options)} }",
        shortCircuit: true,
      }
    if (specifier === "./lib/security-headers")
      return {
        url: new URL("../lib/security-headers.ts", import.meta.url).href,
        shortCircuit: true,
      }
    if (specifier.startsWith("@/"))
      return {
        url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href,
        shortCircuit: true,
      }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith(".ts"))
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
          },
        }).outputText,
      }
    return next(url, context)
  },
})

const headers = await import("../lib/security-headers.ts")
const nextConfig = (await import("../next.config.ts")).default
const { proxy } = await import("../proxy.ts")
const { isSameOriginRequest } = await import("../lib/request-security.ts")
const originalNodeEnv = process.env.NODE_ENV
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL

afterEach(() => {
  forwardedRequestHeaders = undefined
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl
})

test("production CSP is nonce-based and limited to actual resource origins", () => {
  const policy = headers.createContentSecurityPolicy(
    "test-nonce",
    "production",
    "https://appwrite.example/v1"
  )
  assert.match(policy, /script-src 'self' 'nonce-test-nonce' 'strict-dynamic'/)
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/)
  assert.doesNotMatch(policy, /'unsafe-eval'/)
  assert.match(policy, /style-src 'self' 'unsafe-inline'/)
  assert.match(policy, /img-src 'self' data: https:/)
  assert.match(policy, /connect-src 'self' https:\/\/appwrite\.example/)
  assert.match(policy, /frame-ancestors 'none'/)
  assert.match(policy, /object-src 'none'/)
  assert.match(policy, /upgrade-insecure-requests/)
  assert.doesNotMatch(policy, /\bblob:/)
})

test("development CSP permits only the additions needed for HMR", () => {
  const policy = headers.createContentSecurityPolicy(
    "dev-nonce",
    "development"
  )
  assert.match(policy, /'unsafe-eval'/)
  assert.match(policy, /connect-src[^;]*ws: wss:/)
  assert.doesNotMatch(policy, /upgrade-insecure-requests/)
})

test("global headers include frame, MIME, referrer, permissions and production-only HSTS", async () => {
  const production = Object.fromEntries(
    headers.createSecurityHeaders("production").map(({ key, value }) => [
      key,
      value,
    ])
  )
  assert.equal(production["X-Content-Type-Options"], "nosniff")
  assert.equal(
    production["Referrer-Policy"],
    "strict-origin-when-cross-origin"
  )
  assert.equal(production["X-Frame-Options"], "DENY")
  assert.match(production["Permissions-Policy"], /camera=\(\)/)
  assert.match(production["Permissions-Policy"], /microphone=\(\)/)
  assert.doesNotMatch(production["Permissions-Policy"], /clipboard/)
  assert.equal(
    production["Strict-Transport-Security"],
    "max-age=31536000; includeSubDomains"
  )
  assert.doesNotMatch(production["Strict-Transport-Security"], /preload/)
  assert.equal(
    headers
      .createSecurityHeaders("development")
      .some(({ key }) => key === "Strict-Transport-Security"),
    false
  )
  assert.equal(nextConfig.poweredByHeader, false)
  assert.equal((await nextConfig.headers())[0].source, "/(.*)")
})

test("proxy sets the same nonce CSP on the request and response", () => {
  process.env.NODE_ENV = "production"
  const response = proxy(
    new Request("https://zenote.example/chat", {
      headers: { accept: "text/html" },
    })
  )
  const responsePolicy = response.headers.get("content-security-policy")
  assert.ok(responsePolicy)
  assert.equal(
    forwardedRequestHeaders.get("content-security-policy"),
    responsePolicy
  )
  const nonce = forwardedRequestHeaders.get("x-nonce")
  assert.ok(nonce)
  assert.match(responsePolicy, new RegExp(`'nonce-${nonce}'`))
})

test("unsafe API methods require a normalized trusted Origin and ignore forwarded hosts", () => {
  process.env.NODE_ENV = "development"
  const request = (origin, extra = {}) =>
    new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { ...(origin === undefined ? {} : { origin }), ...extra },
    })
  assert.equal(isSameOriginRequest(request("http://localhost:3000")), true)
  assert.equal(isSameOriginRequest(request("HTTP://LOCALHOST:3000")), true)
  assert.equal(isSameOriginRequest(request(undefined)), false)
  assert.equal(isSameOriginRequest(request("null")), false)
  assert.equal(isSameOriginRequest(request("not a URL")), false)
  assert.equal(isSameOriginRequest(request("https://evil.example")), false)
  assert.equal(
    isSameOriginRequest(
      request("http://localhost:3000", {
        "x-forwarded-host": "evil.example",
      })
    ),
    true
  )

  process.env.NODE_ENV = "production"
  process.env.NEXT_PUBLIC_APP_URL = "https://zenote.example"
  const proxied = new Request("http://internal:3000/api/chat", {
    method: "POST",
    headers: { origin: "https://zenote.example" },
  })
  assert.equal(isSameOriginRequest(proxied), true)
  delete process.env.NEXT_PUBLIC_APP_URL
  assert.equal(isSameOriginRequest(proxied), false)
})
