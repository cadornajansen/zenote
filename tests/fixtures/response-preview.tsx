"use client"

import { useState } from "react"
import { ChatMessage } from "@/components/chat-message"
import { markdownFixture } from "./markdown"

// Mounted only by the local rendering harness, never by a production route.
export default function ResponsePreview() {
  const [content, setContent] = useState(markdownFixture)
  const [streaming, setStreaming] = useState(false)
  return (
    <main className="chat-theme mx-auto w-full min-w-0 max-w-[48rem] px-4 py-8 sm:px-6">
      <label htmlFor="fixture">Markdown fixture</label>
      <textarea id="fixture" aria-label="Markdown fixture" className="mb-3 block h-20 w-full" value={content} onChange={(event) => setContent(event.target.value)} />
      <label className="mb-8 block"><input aria-label="Streaming" type="checkbox" checked={streaming} onChange={(event) => setStreaming(event.target.checked)} /> Streaming</label>
      <ChatMessage message={{ id: "preview", role: "assistant", content, status: streaming ? "streaming" : "complete" }} />
    </main>
  )
}
