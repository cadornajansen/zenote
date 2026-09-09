import {
  ArrowUpIcon,
  FileTextIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
  PanelLeftIcon,
  PlusIcon,
} from "lucide-react"

import { ZenoteLogo } from "@/components/zenote-logo"
import { DEFAULT_MODEL_ID, getModel } from "@/lib/models"

export function ProductPreview() {
  return (
    <div
      data-product-preview
      role="img"
      aria-label="Preview of a Zenote conversation with a file attachment and model selector"
      className="copper-halo relative mx-auto grid min-h-[34rem] max-w-6xl overflow-hidden rounded-[1.2rem] border border-white/12 bg-card shadow-[0_42px_120px_-58px_rgba(242,106,33,.58)] before:pointer-events-none before:absolute before:inset-0 before:z-10 before:border before:border-white/5 lg:grid-cols-[15rem_1fr]"
    >
      <aside
        className="hidden border-r border-white/8 bg-sidebar p-4 lg:flex lg:flex-col"
        aria-hidden="true"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <ZenoteLogo className="size-5 text-primary" />
            Zenote
          </div>
          <PanelLeftIcon className="size-4 text-muted-foreground" />
        </div>
        <div className="mt-5 flex items-center gap-2 rounded-lg border border-white/10 bg-background/70 px-3 py-2 text-sm font-medium">
          <PlusIcon className="size-4" />
          New chat
        </div>
        <p className="mt-7 px-2 text-xs font-medium text-muted-foreground">
          Recent
        </p>
        <div className="mt-2 space-y-1 text-sm">
          <div className="rounded-md border border-primary/20 bg-primary/10 px-2 py-2 text-foreground">
            Launch plan from brief
          </div>
          <div className="px-2 py-2 text-muted-foreground">
            Explain this diagram
          </div>
          <div className="px-2 py-2 text-muted-foreground">
            Writing feedback
          </div>
        </div>
        <div className="mt-auto flex items-center gap-3 border-t pt-4">
          <div className="grid size-8 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            AK
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Alex Kim</p>
            <p className="text-xs text-muted-foreground">Free plan</p>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <div className="flex h-14 items-center justify-between border-b border-white/8 px-4 sm:px-6">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span>{getModel(DEFAULT_MODEL_ID)?.name}</span>
            <span className="size-1.5 rounded-full bg-primary" />
          </div>
          <MoreHorizontalIcon
            className="size-5 text-muted-foreground"
            aria-hidden="true"
          />
        </div>

        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:px-8 sm:py-12">
          <div className="ml-auto max-w-[82%] rounded-2xl rounded-br-sm border border-white/5 bg-secondary px-4 py-3 text-sm leading-6 sm:max-w-[70%]">
            Turn this product brief into a focused launch plan. Keep it
            practical.
          </div>
          <div className="mt-2 ml-auto flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/8 px-3 py-2 text-xs text-muted-foreground">
            <FileTextIcon className="size-4 text-primary" />
            product-brief.pdf
          </div>

          <div className="mt-8 flex gap-3">
            <ZenoteLogo className="mt-0.5 size-7 shrink-0 text-primary" />
            <div className="max-w-2xl text-sm leading-7 text-foreground/90">
              <p className="font-medium text-foreground">
                Here is a focused three-part launch plan:
              </p>
              <ol className="mt-3 space-y-3">
                <li>
                  <strong>1. Clarify the promise.</strong> Lead with one clear
                  reason to choose Zenote and keep the first release centered on
                  chat.
                </li>
                <li>
                  <strong>2. Make the product visible.</strong> Let the
                  interface demonstrate model choice, attachments, and
                  conversation continuity.
                </li>
                <li>
                  <strong>3. Validate the economics.</strong> Set final PHP
                  pricing only after model costs and safe usage allowances are
                  understood.
                </li>
              </ol>
            </div>
          </div>

          <div className="mt-auto pt-10">
            <div className="rounded-2xl border border-white/12 bg-[#0d0c0b] p-3 shadow-[0_12px_32px_-20px_rgba(0,0,0,.9)]">
              <p className="px-1 pb-7 text-sm text-muted-foreground">
                Ask anything...
              </p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className="grid size-8 place-items-center rounded-lg border border-white/10 bg-white/[.025]">
                    <PaperclipIcon className="size-4" />
                  </span>
                  <span className="hidden text-xs sm:inline">
                    Add image or file
                  </span>
                </div>
                <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-[0_0_20px_-6px_rgba(242,106,33,.85)]">
                  <ArrowUpIcon className="size-4" />
                </span>
              </div>
            </div>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Product preview. Responses may be inaccurate.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
