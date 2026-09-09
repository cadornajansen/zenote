import type { Metadata } from "next"

import { Pricing } from "@/components/pricing"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Explore Zenote Free, Plus, and Pro plan concepts. Final PHP pricing and usage limits are coming soon.",
}

const planRows = [
  ["AI model access", "Selected", "Expanded", "Widest"],
  ["Usage allowance", "Everyday trial", "Regular use", "Demanding use"],
  ["Conversation history", "Included", "Included", "Included"],
  ["Supported attachments", "Included", "Priority access", "Priority access"],
  ["PHP billing", "No payment needed", "Planned", "Planned"],
]

export default function PricingPage() {
  return (
    <>
      <section className="relative overflow-hidden px-5 pt-24 pb-20 sm:px-8 sm:pt-32 sm:pb-28">
        <div
          aria-hidden="true"
          className="public-grid absolute inset-x-0 top-0 -z-10 h-[34rem]"
        />
        <div className="mx-auto max-w-7xl">
          <p className="font-mono text-xs tracking-[0.16em] text-primary uppercase">
            Plans
          </p>
          <h1 className="mt-6 max-w-5xl text-[clamp(3.5rem,8vw,7rem)] leading-[0.94] font-semibold tracking-[-0.075em]">
            More room for your best work.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-muted-foreground">
            Zenote will launch with Free, Plus, and Pro plans. Final PHP prices
            and allowances will follow validated model economics.
          </p>
        </div>
      </section>

      <section className="px-5 pb-28 sm:px-8 sm:pb-40">
        <div className="mx-auto max-w-7xl">
          <Pricing />
        </div>
      </section>

      <section className="border-y border-border/80 bg-[#0f0e0d] px-5 py-24 sm:px-8 sm:py-32">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-4xl font-semibold tracking-[-0.05em] sm:text-6xl">
            A clear comparison.
          </h2>
          <div className="mt-14 overflow-x-auto">
            <table className="w-full min-w-3xl border-collapse text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-5 pr-6 font-medium text-muted-foreground">
                    What you get
                  </th>
                  <th className="px-6 py-5 text-lg">Free</th>
                  <th className="px-6 py-5 text-lg text-primary">Plus</th>
                  <th className="px-6 py-5 text-lg">Pro</th>
                </tr>
              </thead>
              <tbody>
                {planRows.map(([label, free, plus, pro]) => (
                  <tr key={label} className="border-b last:border-b-0">
                    <th className="py-5 pr-6 font-medium">{label}</th>
                    <td className="px-6 py-5 text-muted-foreground">{free}</td>
                    <td className="px-6 py-5 text-muted-foreground">{plus}</td>
                    <td className="px-6 py-5 text-muted-foreground">{pro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="px-5 py-28 sm:px-8 sm:py-40">
        <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[0.75fr_1.25fr]">
          <div>
            <h2 className="text-5xl font-semibold tracking-[-0.06em] sm:text-6xl">
              Pricing questions.
            </h2>
            <p className="mt-5 max-w-sm leading-7 text-muted-foreground">
              The structure is set. The numbers will be published when they are
              ready.
            </p>
          </div>
          <Accordion className="border-t">
            <AccordionItem value="pricing-timing">
              <AccordionTrigger className="py-5 text-base hover:no-underline">
                When will final pricing be available?
              </AccordionTrigger>
              <AccordionContent className="pb-6 leading-7 text-muted-foreground">
                Before paid plans launch. Zenote will validate model costs and
                sustainable usage allowances before publishing permanent PHP
                prices.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="free-plan">
              <AccordionTrigger className="py-5 text-base hover:no-underline">
                Will Zenote have a free plan?
              </AccordionTrigger>
              <AccordionContent className="pb-6 leading-7 text-muted-foreground">
                Yes. The Free plan will provide a practical way to try core chat
                with selected models and controlled usage.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="payments">
              <AccordionTrigger className="py-5 text-base hover:no-underline">
                How will I pay?
              </AccordionTrigger>
              <AccordionContent className="pb-6 leading-7 text-muted-foreground">
                Zenote is planning PHP billing with GCash, Maya, cards, and QRPh
                where payment-provider support is available.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </section>
    </>
  )
}
