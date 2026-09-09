"use client"

import { useRef, useState, type FormEvent } from "react"
import {
  ArrowUpIcon,
  FileTextIcon,
  LightbulbIcon,
  PenLineIcon,
  SparklesIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

const suggestions = [
  {
    icon: PenLineIcon,
    label: "Write something",
    prompt: "Help me turn a rough idea into something worth reading.",
  },
  {
    icon: LightbulbIcon,
    label: "Think it through",
    prompt: "Help me think through a decision, one question at a time.",
  },
  {
    icon: FileTextIcon,
    label: "Understand a topic",
    prompt: "Explain a complicated topic in simple terms, with an example.",
  },
]

export function HeroComposer() {
  const [prompt, setPrompt] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
  }

  return (
    <div className="mt-9 w-full max-w-[38rem] text-left">
      <form
        onSubmit={handleSubmit}
        className="hero-composer rounded-2xl p-3 sm:p-4"
      >
        <label htmlFor="hero-prompt" className="sr-only">
          What would you like to ask Zenote?
        </label>
        <Textarea
          ref={input}
          id="hero-prompt"
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value)
            setSubmitted(false)
          }}
          placeholder="Ask Zenote anything. Start with an idea…"
          maxLength={2000}
          className="max-h-44 min-h-20 resize-none border-0 bg-transparent px-2 py-2 text-base shadow-none placeholder:text-[#c4aea0] focus-visible:ring-0 md:text-sm dark:bg-transparent"
        />
        <div className="flex items-center justify-between gap-3 px-1 pt-2">
          <span className="flex items-center gap-2 text-xs text-[#cab4a5]">
            <SparklesIcon className="size-3.5 text-primary" /> Your next idea
            starts here
          </span>
          <Button
            type="submit"
            size="icon-lg"
            aria-label="Send preview prompt"
            className="size-10 rounded-full border border-orange-300/35 bg-primary text-primary-foreground shadow-[0_0_24px_-7px_#f26a21]"
          >
            <ArrowUpIcon className="size-5" />
          </Button>
        </div>
      </form>
      <p
        role="status"
        className="mt-3 min-h-5 text-center text-xs leading-5 text-[#ead0bc]"
      >
        {submitted
          ? "Live chat is coming soon. Your prompt stays in this browser tab."
          : "A little inspiration to get you started"}
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {suggestions.map(({ icon: Icon, label, prompt: suggestion }) => (
          <Button
            key={label}
            type="button"
            variant="outline"
            onClick={() => {
              setPrompt(suggestion)
              setSubmitted(false)
              input.current?.focus()
            }}
            className="h-9 rounded-full border-white/15 bg-black/15 px-3 text-xs text-[#f4dfcf] hover:bg-white/10 dark:border-white/15 dark:bg-black/15 dark:hover:bg-white/10"
          >
            <Icon className="size-3.5" />
            {label}
          </Button>
        ))}
      </div>
    </div>
  )
}
