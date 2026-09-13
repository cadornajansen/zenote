import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { afterEach, beforeEach, test } from "node:test"
import { AppwriteException } from "node-appwrite"
import ts from "typescript"

let account
let sessionClient
let cookieCalls

globalThis.__authAdmin = () => ({ account })
globalThis.__authSession = () => sessionClient
globalThis.__authCookies = () => ({
  set: (...args) => cookieCalls.push(args),
  get: () => undefined,
})

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only")
      return { url: "data:text/javascript,export {}", shortCircuit: true }
    if (specifier === "next/headers")
      return {
        url: "data:text/javascript,export const cookies=async()=>globalThis.__authCookies()",
        shortCircuit: true,
      }
    if (specifier === "next/navigation")
      return {
        url: "data:text/javascript,export const redirect=(target)=>{const error=new Error('redirect'); error.target=target; throw error}",
        shortCircuit: true,
      }
    if (specifier === "next/server")
      return {
        url: "data:text/javascript,export class NextResponse { static redirect(url){ return new Response(null,{status:307,headers:{location:String(url)}}) } }",
        shortCircuit: true,
      }
    if (specifier === "@/lib/appwrite-server")
      return {
        url: `data:text/javascript,
          export const APPWRITE_SESSION_COOKIE="zenote-session";
          export const createAdminServerClient=()=>globalThis.__authAdmin();
          export const createSessionClient=async()=>globalThis.__authSession();
          export const isTrustedAppwriteOAuthUrl=(value)=>{try{return new URL(value).origin==="https://sgp.cloud.appwrite.io"}catch{return false}}`,
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

process.env.NEXT_PUBLIC_APP_URL = "https://zenote.example"
const auth = await import("../lib/auth.ts")
const callback = await import("../app/auth/oauth/callback/route.ts")
const actions = await import("../app/(auth)/actions.ts")
const originalNodeEnv = process.env.NODE_ENV

const session = {
  secret: "session-secret",
  expire: "2030-01-01T00:00:00.000Z",
}

beforeEach(() => {
  cookieCalls = []
  sessionClient = null
  account = {
    create: async () => ({ $id: "owner" }),
    createEmailPasswordSession: async () => session,
    createOAuth2Token: async () =>
      "https://sgp.cloud.appwrite.io/v1/account/tokens/oauth2/google",
    createSession: async () => session,
    createRecovery: async () => ({ $id: "token" }),
    updateRecovery: async () => ({ $id: "token" }),
  }
})

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
})

test("session cookie is HttpOnly, production Secure, SameSite Lax and root-scoped", async () => {
  process.env.NODE_ENV = "production"
  await auth.signInWithEmail("owner@example.com", "password")
  const [name, value, options] = cookieCalls[0]
  assert.equal(name, "zenote-session")
  assert.equal(value, "session-secret")
  assert.equal(options.httpOnly, true)
  assert.equal(options.secure, true)
  assert.equal(options.sameSite, "lax")
  assert.equal(options.path, "/")
  assert.equal(options.expires.toISOString(), session.expire)

  process.env.NODE_ENV = "development"
  cookieCalls = []
  await auth.signInWithEmail("owner@example.com", "password")
  assert.equal(cookieCalls[0][2].secure, false)
})

test("logout clears the root cookie even when Appwrite session deletion fails", async () => {
  sessionClient = {
    account: {
      deleteSession: async () => {
        throw new Error("provider internals")
      },
    },
  }
  await assert.rejects(auth.signOut(), /provider internals/)
  const [name, value, options] = cookieCalls[0]
  assert.equal(name, "zenote-session")
  assert.equal(value, "")
  assert.equal(options.httpOnly, true)
  assert.equal(options.sameSite, "lax")
  assert.equal(options.path, "/")
  assert.equal(options.expires.getTime(), 0)
})

test("missing, invalid and expired sessions fail closed", async () => {
  assert.equal(await auth.getCurrentUser(), null)
  sessionClient = {
    account: {
      get: async () => {
        throw new AppwriteException("expired provider session", 401)
      },
    },
  }
  assert.equal(await auth.getCurrentUser(), null)
})

test("OAuth callback rejects malformed or failed exchanges without setting a cookie", async () => {
  let sessionCalls = 0
  account.createSession = async () => {
    sessionCalls++
    throw new Error("exchange failed")
  }
  let response = await callback.GET({
    nextUrl: new URL(
      "https://attacker.example/auth/oauth/callback?userId=../bad&secret=secret"
    ),
  })
  assert.equal(response.headers.get("location"), "https://zenote.example/login?error=oauth")
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(response.headers.get("referrer-policy"), "no-referrer")
  assert.equal(sessionCalls, 0)
  assert.equal(cookieCalls.length, 0)

  response = await callback.GET({
    nextUrl: new URL(
      "https://attacker.example/auth/oauth/callback?userId=owner&secret=valid-secret"
    ),
  })
  assert.equal(response.headers.get("location"), "https://zenote.example/login?error=oauth")
  assert.equal(sessionCalls, 1)
  assert.equal(cookieCalls.length, 0)
})

test("OAuth callback accepts Appwrite token secrets without imposing a format", async () => {
  const response = await callback.GET({
    nextUrl: new URL(
      "https://zenote.example/auth/oauth/callback?userId=owner&secret=token%2Bwith%2Fprovider%3Dcharacters"
    ),
  })
  assert.equal(response.headers.get("location"), "https://zenote.example/chat")
  assert.equal(cookieCalls.length, 1)
})

test("OAuth success uses fixed trusted redirects and rejects untrusted authorization URLs", async () => {
  const response = await callback.GET({
    nextUrl: new URL(
      "https://attacker.example/auth/oauth/callback?userId=owner&secret=valid-secret&returnTo=https://evil.example"
    ),
  })
  assert.equal(response.headers.get("location"), "https://zenote.example/chat")
  assert.equal(cookieCalls.length, 1)

  account.createOAuth2Token = async () => "https://evil.example/authorize"
  await assert.rejects(auth.signInWithGoogle(), /untrusted OAuth URL/)
})

test("OAuth initiation uses fixed Appwrite callbacks and sign-up stores no cookie on failure", async () => {
  let oauthOptions
  account.createOAuth2Token = async (options) => {
    oauthOptions = options
    return "https://sgp.cloud.appwrite.io/v1/account/tokens/oauth2/google"
  }
  assert.match(await auth.signInWithGoogle(), /^https:\/\/sgp\.cloud\.appwrite\.io/)
  assert.equal(oauthOptions.provider, "google")
  assert.equal(
    oauthOptions.success,
    "https://zenote.example/auth/oauth/callback"
  )
  assert.equal(oauthOptions.failure, "https://zenote.example/login?error=oauth")

  account.create = async () => {
    throw new Error("sign-up failed")
  }
  await assert.rejects(
    auth.signUpWithEmail("Owner", "owner@example.com", "password")
  )
  assert.equal(cookieCalls.length, 0)
})

test("malformed recovery inputs fail before Appwrite and auth errors stay sanitized", async () => {
  let updates = 0
  account.updateRecovery = async () => {
    updates++
  }
  const form = new FormData()
  form.set("userId", "../bad")
  form.set("secret", "secret")
  form.set("password", "valid-password")
  form.set("confirmPassword", "valid-password")
  assert.deepEqual(await actions.resetPasswordAction({}, form), {
    error: "This recovery link is invalid.",
  })
  assert.equal(updates, 0)
  let recoveryCalls = 0
  account.createRecovery = async () => recoveryCalls++
  const forgot = new FormData()
  forgot.set("email", `${"x".repeat(255)}@example.com`)
  assert.deepEqual(await actions.forgotPasswordAction({}, forgot), {
    error: "Enter a valid email address.",
  })
  assert.equal(recoveryCalls, 0)
  let signups = 0
  account.create = async () => {
    signups++
  }
  const signup = new FormData()
  signup.set("name", "x".repeat(129))
  signup.set("email", "owner@example.com")
  signup.set("password", "valid-password")
  assert.deepEqual(await actions.signUpAction({}, signup), {
    error: "Enter your name.",
  })
  assert.equal(signups, 0)
  assert.doesNotMatch(
    auth.getAuthErrorMessage(new Error("api key and provider body")),
    /api key|provider body/
  )
  assert.equal(
    auth.getAuthErrorMessage(
      new AppwriteException("private details", 404, "user_not_found")
    ),
    "Invalid email or password."
  )
})

test("password recovery does not reveal whether an account exists", async () => {
  account.createRecovery = async () => {
    throw new AppwriteException(
      "private account lookup details",
      404,
      "user_not_found"
    )
  }
  await assert.doesNotReject(
    auth.startPasswordRecovery("unknown@example.com")
  )
})
