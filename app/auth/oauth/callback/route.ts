import { type NextRequest, NextResponse } from "next/server"

import {
  applicationUrl,
  completeGoogleSignIn,
  isValidAuthTokenInput,
} from "@/lib/auth"

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")
  const secret = request.nextUrl.searchParams.get("secret")

  if (!userId || !secret || !isValidAuthTokenInput(userId, secret)) {
    return oauthRedirect("/login?error=oauth")
  }

  try {
    await completeGoogleSignIn(userId, secret)
    return oauthRedirect("/chat")
  } catch {
    return oauthRedirect("/login?error=oauth")
  }
}

function oauthRedirect(path: string) {
  const response = NextResponse.redirect(applicationUrl(path))
  response.headers.set("Cache-Control", "no-store")
  response.headers.set("Referrer-Policy", "no-referrer")
  return response
}
