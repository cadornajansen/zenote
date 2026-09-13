const DEFAULT_APPWRITE_ENDPOINT = "https://sgp.cloud.appwrite.io/v1"

export type SecurityHeader = { key: string; value: string }

function httpOrigin(value: string | undefined, fallback: string) {
  try {
    const url = new URL(value || fallback)
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : new URL(fallback).origin
  } catch {
    return new URL(fallback).origin
  }
}

export function createContentSecurityPolicy(
  nonce: string,
  environment = process.env.NODE_ENV,
  appwriteEndpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT
) {
  const production = environment === "production"
  const connectSources = new Set([
    "'self'",
    httpOrigin(appwriteEndpoint, DEFAULT_APPWRITE_ENDPOINT),
    ...(!production ? ["ws:", "wss:"] : []),
  ])
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
      production ? "" : " 'unsafe-eval'"
    }`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    `connect-src ${[...connectSources].join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    ...(production ? ["upgrade-insecure-requests"] : []),
  ].join("; ")
}

export function createSecurityHeaders(
  environment = process.env.NODE_ENV
): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value:
        "accelerometer=(), browsing-topics=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
    },
  ]
  if (environment === "production") {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    })
  }
  return headers
}
