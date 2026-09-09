"use client"

import { memo, useEffect, useRef, useState, type ComponentProps } from "react"
import { createCodePlugin } from "@streamdown/code"
import { createMathPlugin } from "@streamdown/math"
import { CheckIcon, CopyIcon } from "lucide-react"
import { CodeBlock, Streamdown, useIsCodeFenceIncomplete } from "streamdown"

import { Button } from "@/components/ui/button"
import { normalizeMath } from "@/lib/markdown"

// One lazy, cached highlighter for the conversation; both slots stay dark.
const plugins = {
  code: createCodePlugin({ themes: ["github-dark", "github-dark"] }),
  math: createMathPlugin({ singleDollarTextMath: true }),
}

function ResponseCode({ children, className }: ComponentProps<"code">) {
  const incomplete = useIsCodeFenceIncomplete()
  const source = String(children ?? "").replace(/\n$/, "")
  const language = className?.match(/language-([^\s]+)/)?.[1].toLowerCase() || "text"
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(source)
      setCopied(true)
      setError(false)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1800)
    } catch {
      setError(true)
    }
  }

  return (
    <CodeBlock code={source} language={language} isIncomplete={incomplete} lineNumbers={false}>
      <Button
        variant="ghost"
        size="xs"
        onClick={copy}
        disabled={incomplete}
        aria-label={error ? "Copy failed. Try copying again" : copied ? "Copied code" : "Copy code"}
        className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
        <span aria-live="polite">{error ? "Try again" : copied ? "Copied" : "Copy"}</span>
      </Button>
    </CodeBlock>
  )
}

function InlineCode({ children }: ComponentProps<"code">) {
  return <code>{children}</code>
}

const components = { code: ResponseCode, inlineCode: InlineCode }

export const AiResponse = memo(function AiResponse({
  content,
  streaming = false,
}: {
  content: string
  streaming?: boolean
}) {
  return (
    <Streamdown
      className="ai-response min-w-0 max-w-full"
      plugins={plugins}
      components={components}
      mode="streaming"
      isAnimating={streaming}
      parseIncompleteMarkdown
      controls={false}
      codeBlockMaxHeight={0}
      tableMaxHeight={0}
      lineNumbers={false}
      skipHtml
    >
      {normalizeMath(content)}
    </Streamdown>
  )
})
