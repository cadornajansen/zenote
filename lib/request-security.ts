import "server-only"

export function isAppwriteId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,35}$/.test(value)
  )
}

function expectedOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (process.env.NODE_ENV !== "production") {
    return new URL(request.url).origin
  }
  if (!configured) throw new Error("NEXT_PUBLIC_APP_URL is required")
  const url = new URL(configured)
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("NEXT_PUBLIC_APP_URL must be a public HTTPS origin")
  }
  return url.origin
}

export function isSameOriginRequest(request: Request) {
  const value = request.headers.get("origin")
  if (!value || value === "null") return false
  try {
    return new URL(value).origin === expectedOrigin(request)
  } catch {
    return false
  }
}
