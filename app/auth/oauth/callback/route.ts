import { type NextRequest, NextResponse } from "next/server"

import { completeGoogleSignIn } from "@/lib/auth"

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")
  const secret = request.nextUrl.searchParams.get("secret")

  if (!userId || !secret) {
    return NextResponse.redirect(new URL("/login?error=oauth", request.url))
  }

  try {
    await completeGoogleSignIn(userId, secret)
    return NextResponse.redirect(new URL("/chat", request.url))
  } catch {
    return NextResponse.redirect(new URL("/login?error=oauth", request.url))
  }
}
