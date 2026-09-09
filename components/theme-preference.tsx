"use client"

import { useEffect, useState } from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type ThemeTone = "warm" | "neutral"

export function ThemePreference() {
  const [tone, setTone] = useState<ThemeTone>(() =>
    typeof document !== "undefined" &&
    document.body.dataset.chatTone === "neutral"
      ? "neutral"
      : "warm"
  )

  useEffect(() => {
    document.body.dataset.chatTone = tone
  }, [tone])

  return (
    <Select value={tone} onValueChange={(value) => setTone(value as ThemeTone)}>
      <SelectTrigger aria-label="Chat theme" className="w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        align="end"
        alignItemWithTrigger={false}
        className="[width:var(--anchor-width)] [min-width:var(--anchor-width)]"
      >
        <SelectItem value="warm">Warm charcoal</SelectItem>
        <SelectItem value="neutral">Neutral dark</SelectItem>
      </SelectContent>
    </Select>
  )
}
