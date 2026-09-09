import Link from "next/link"
import type { Metadata } from "next"
import { ArrowRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

export const metadata: Metadata = {
  title: "About",
  description:
    "Why Zenote is being built and what we believe everyday AI should feel like.",
}

export default function AboutPage() {
  return (
    <>
      <section className="relative overflow-hidden px-5 pt-24 pb-24 sm:px-8 sm:pt-32 sm:pb-36">
        <div
          aria-hidden="true"
          className="public-grid absolute inset-x-0 top-0 -z-10 h-[33rem]"
        />
        <div className="mx-auto max-w-7xl">
          <p className="font-mono text-xs tracking-[0.16em] text-primary uppercase">
            Why Zenote
          </p>
          <h1 className="mt-6 max-w-6xl text-[clamp(3.5rem,8vw,7rem)] leading-[0.94] font-semibold tracking-[-0.075em]">
            AI should feel useful before it feels impressive.
          </h1>
        </div>
      </section>

      <section className="border-y border-border/80 bg-[#0f0e0d] px-5 py-24 sm:px-8 sm:py-32">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2 lg:gap-24">
          <h2 className="text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
            What Zenote is
          </h2>
          <div className="space-y-6 text-lg leading-8 text-muted-foreground">
            <p>
              Zenote is one place to talk with capable AI, work with supported
              files, and return to useful conversations. It follows a familiar
              chat model so the technology stays out of the way.
            </p>
            <p>
              The goal is not to pack every possible AI feature into one screen.
              It is to make the core experience dependable, generous, and easy
              to understand.
            </p>
          </div>
        </div>
      </section>

      <section className="px-5 py-24 sm:px-8 sm:py-36">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2 lg:gap-24">
          <h2 className="text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
            Why we are building it
          </h2>
          <div className="space-y-6 text-lg leading-8 text-muted-foreground">
            <p>
              People increasingly use several AI products because different
              models are good at different things. Zenote brings strong options
              into one coherent interface without exposing the infrastructure
              behind them.
            </p>
            <p>
              It is also designed with Philippine users in mind, including PHP
              pricing and locally practical payment methods where supported.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-[#16110e] px-5 py-24 text-foreground sm:px-8 sm:py-36">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2 lg:gap-24">
          <h2 className="text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
            What we believe
          </h2>
          <div>
            <p className="max-w-2xl text-2xl leading-10 text-muted-foreground">
              Good AI should be clear about what it can do, calm enough to use
              every day, and priced in a way that gives people room to think.
            </p>
            <Button
              className="mt-10 shadow-[0_0_30px_-10px_rgba(242,106,33,.78)]"
              nativeButton={false}
              render={<Link href="/login" />}
            >
              Try Zenote
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </div>
        </div>
      </section>
    </>
  )
}
