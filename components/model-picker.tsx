"use client"

import { useState } from "react"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { models, type ModelConfig } from "@/lib/models"
import { cn } from "@/lib/utils"

export function ModelPicker({
  value,
  onValueChange,
  compact = false,
}: {
  value: string
  onValueChange: (value: string) => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selected = models.find((model) => model.id === value) ?? models[0]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60",
          compact && "h-7 text-xs text-muted-foreground"
        )}
        aria-label={`Select model, currently ${selected.name}`}
      >
        <span className="truncate">{selected.name}</span>
        <ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(22rem,calc(100vw-2rem))] p-1"
      >
        <Command>
          <CommandInput placeholder="Search models..." />
          <CommandList>
            <CommandEmpty>No models found.</CommandEmpty>
            <CommandGroup heading="Models">
              {models.map((model) => (
                <ModelOption
                  key={model.id}
                  model={model}
                  selected={value === model.id}
                  onSelect={(nextValue) => {
                    onValueChange(nextValue)
                    setOpen(false)
                  }}
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function ModelOption({
  model,
  selected,
  onSelect,
}: {
  model: ModelConfig
  selected: boolean
  onSelect: (value: string) => void
}) {
  return (
    <CommandItem
      value={`${model.name} ${model.description}`}
      onSelect={() => onSelect(model.id)}
      className="items-start py-2.5"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{model.name}</span>
          {selected && <CheckIcon className="size-3.5 text-primary" />}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {model.description}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(model.capabilities.text ? ["Text"] : []).map((capability) => (
            <span
              key={capability}
              className="text-[11px] text-muted-foreground/80"
            >
              {capability}
            </span>
          ))}
        </div>
      </div>
    </CommandItem>
  )
}
