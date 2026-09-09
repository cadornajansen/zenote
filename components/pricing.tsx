import Link from "next/link"
import { ArrowUpRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

const plans = [
  {
    name: "Free",
    description: "A practical way to start with Zenote.",
    availability: "Free at launch",
    features: [
      "Selected AI models",
      "Core chat and history",
      "Supported file inputs",
    ],
  },
  {
    name: "Plus",
    description: "More room for regular AI work.",
    availability: "PHP pricing coming soon",
    features: [
      "Expanded model access",
      "Higher usage allowance",
      "Priority access to multimodal models",
    ],
    featured: true,
  },
  {
    name: "Pro",
    description: "The highest capacity for demanding use.",
    availability: "PHP pricing coming soon",
    features: [
      "Widest model access",
      "Highest usage allowance",
      "Access to premium capabilities",
    ],
  },
]

export function Pricing() {
  return (
    <div>
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => (
          <article
            key={plan.name}
            className={`copper-card relative flex min-h-[25rem] flex-col overflow-hidden rounded-xl p-6 sm:p-8 ${
              plan.featured ? "copper-card-featured text-foreground" : ""
            }`}
          >
            {plan.featured && (
              <div className="absolute inset-x-0 top-0 h-px bg-primary" />
            )}
            <div>
              <h3 className="text-2xl font-semibold tracking-[-0.04em]">
                {plan.name}
              </h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {plan.description}
              </p>
            </div>
            <p className="mt-10 font-mono text-xs tracking-[0.12em] text-primary uppercase">
              {plan.availability}
            </p>
            <ul className="mt-8 space-y-3 text-sm text-muted-foreground">
              {plan.features.map((feature) => (
                <li key={feature} className="flex gap-2.5">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-primary" />
                  {feature}
                </li>
              ))}
            </ul>
            <Button
              className={
                plan.featured
                  ? "mt-auto shadow-[0_0_26px_-10px_rgba(242,106,33,.75)]"
                  : "mt-auto"
              }
              variant={plan.featured ? "default" : "outline"}
              nativeButton={false}
              render={<Link href="/login" />}
            >
              Try Zenote <ArrowUpRightIcon data-icon="inline-end" />
            </Button>
          </article>
        ))}
      </div>
      <p className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">
        Final prices and limits will be published after model economics are
        validated. We will not promise allowances we cannot sustain.
      </p>
    </div>
  )
}
