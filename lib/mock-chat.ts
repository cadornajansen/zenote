export type MockConversation = {
  id: string
  title: string
  updatedAt: string
}

export type MockAttachment = {
  id: string
  name: string
  type: "image" | "document" | "audio"
  size: string
  status: "attached" | "processing" | "ready" | "error"
}

export type MockMessageBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "list"; items: string[] }
  | { type: "code"; language: string; code: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "sources"; items: { label: string; href: string }[] }
  | { type: "image"; label: string; description: string }

export type MockMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  status?: "thinking" | "streaming" | "complete" | "stopped" | "failed"
  thoughtSeconds?: number
  blocks?: MockMessageBlock[]
  attachments?: MockAttachment[]
  error?: string
  requestId?: string
  requestedModel?: string
  actualModel?: string
}

export const mockConversations: MockConversation[] = [
  {
    id: "nextjs-caching",
    title: "Researching Next.js caching",
    updatedAt: "Today",
  },
  {
    id: "calculus",
    title: "Explain this calculus problem",
    updatedAt: "Today",
  },
  {
    id: "landing-page",
    title: "Review my landing page",
    updatedAt: "Yesterday",
  },
  { id: "study-plan", title: "Plan a study schedule", updatedAt: "Yesterday" },
  {
    id: "appwrite-auth",
    title: "Debug Appwrite authentication",
    updatedAt: "Sep 7",
  },
  {
    id: "model-comparison",
    title: "Compare Claude and GPT",
    updatedAt: "Sep 6",
  },
]

export const mockAttachments: MockAttachment[] = [
  {
    id: "image",
    name: "image.png",
    type: "image",
    size: "1.8 MB",
    status: "ready",
  },
  {
    id: "lecture",
    name: "lecture.pdf",
    type: "document",
    size: "3.2 MB",
    status: "processing",
  },
  {
    id: "notes",
    name: "notes.docx",
    type: "document",
    size: "680 KB",
    status: "ready",
  },
  {
    id: "recording",
    name: "recording.mp3",
    type: "audio",
    size: "8.4 MB",
    status: "error",
  },
]

export const mockMessages: MockMessage[] = [
  {
    id: "question-caching",
    role: "user",
    content:
      "Can you explain the difference between request memoization and the Data Cache in Next.js?",
    status: "complete",
    attachments: [mockAttachments[1]],
  },
  {
    id: "answer-caching",
    role: "assistant",
    content:
      "They solve related but different problems. Request memoization removes duplicate work during one render, while the Data Cache can preserve results across requests.",
    status: "complete",
    thoughtSeconds: 4,
    blocks: [
      {
        type: "paragraph",
        text: "They solve related but different problems. Request memoization removes duplicate work during one render, while the Data Cache can preserve results across requests.",
      },
      { type: "heading", text: "The practical difference" },
      {
        type: "table",
        headers: ["Feature", "Request memoization", "Data Cache"],
        rows: [
          ["Lifetime", "One server render", "Across requests"],
          ["Scope", "React component tree", "Application deployment"],
          ["Best for", "Deduplicating fetches", "Reusing stable data"],
        ],
      },
      {
        type: "list",
        items: [
          "Use memoization when several components request the same data during a render.",
          "Use the Data Cache when data can be safely reused between visitors or requests.",
          "Keep user-specific or rapidly changing data dynamic unless you have an explicit cache policy.",
        ],
      },
      {
        type: "code",
        language: "tsx",
        code: 'const post = await fetch(url, {\n  cache: "force-cache",\n})',
      },
      {
        type: "image",
        label: "Caching flow",
        description:
          "A request passes through render-level memoization before reaching the persistent Data Cache.",
      },
      {
        type: "sources",
        items: [
          {
            label: "Next.js caching guide",
            href: "https://nextjs.org/docs/app/guides/caching",
          },
          {
            label: "React cache reference",
            href: "https://react.dev/reference/react/cache",
          },
        ],
      },
    ],
  },
]

export const quickActions = [
  { label: "Create", prompt: "Create a concise outline for " },
  {
    label: "Analyze image",
    prompt: "Analyze this image and highlight the important details.",
  },
  { label: "Help me code", prompt: "Help me debug this code: " },
  {
    label: "Explain",
    prompt: "Explain this clearly with a practical example: ",
  },
]
