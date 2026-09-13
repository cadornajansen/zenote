"use client"

import { useEffect } from "react"

import { pingAppwrite } from "@/lib/appwrite"

let hasPinged = false

export function AppwriteStartupPing() {
  useEffect(() => {
    if (hasPinged) return
    hasPinged = true

    void pingAppwrite()
      .then(() => {
        console.info("[Appwrite] connection ready")
      })
      .catch(() => {
        console.error("[Appwrite] connection failed")
      })
  }, [])

  return null
}
