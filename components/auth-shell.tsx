import Link from "next/link"

import { ZenoteLogo } from "@/components/zenote-logo"

type AuthShellProps = {
  title: string
  description: string
  children: React.ReactNode
}

export function AuthShell({ title, description, children }: AuthShellProps) {
  return (
    <div className="max-h-[calc(100svh-2rem)] w-full max-w-sm [scrollbar-width:none] overflow-y-auto px-0.5 py-0.5 [&::-webkit-scrollbar]:hidden">
      <Link
        href="/"
        className="mx-auto flex w-fit items-center gap-2 text-base font-semibold tracking-[-0.04em] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ZenoteLogo className="size-5 text-primary" />
        Zenote
      </Link>
      <div className="mt-5 rounded-xl border border-white/10 bg-[#0f0e0d]/95 p-5 shadow-[0_24px_70px_-44px_rgba(242,106,33,.45)] backdrop-blur sm:p-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-[-0.05em]">{title}</h1>
          <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        </header>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  )
}
