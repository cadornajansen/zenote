import Link from "next/link"
import type { Metadata } from "next"
import {
  ArrowRightIcon,
  FileAudioIcon,
  FileTextIcon,
  ImageIcon,
  LayersIcon,
  MessagesSquareIcon,
  ScanSearchIcon,
  SparklesIcon,
} from "lucide-react"

import { LandingMotion } from "@/components/landing-motion"
import { HeroComposer } from "@/components/hero-composer"
import { Pricing } from "@/components/pricing"
import { ProductPreview } from "@/components/product-preview"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = {
  title: "Your AI for anything",
}

const capabilities = [
  {
    icon: MessagesSquareIcon,
    title: "Ask anything",
    description:
      "Think out loud, solve a problem, draft an idea, or learn something new in a natural conversation.",
  },
  {
    icon: ScanSearchIcon,
    title: "Work with files",
    description:
      "Bring supported documents and images into the conversation when the selected model can understand them.",
  },
  {
    icon: SparklesIcon,
    title: "Choose your intelligence",
    description:
      "Move between capable AI models without managing a separate product for every kind of work.",
  },
  {
    icon: LayersIcon,
    title: "Continue where you left off",
    description:
      "Keep conversations organized so useful context is ready when you return.",
  },
]

const faqs = [
  {
    value: "what-is-zenote",
    question: "What is Zenote?",
    answer:
      "Zenote is an AI chat product that brings strong models, supported file inputs, and conversation history into one clean interface.",
  },
  {
    value: "models",
    question: "Which AI models can I use?",
    answer:
      "Zenote plans to offer a curated mix of leading models. The final launch catalogue will be published only after availability, quality, and cost are validated.",
  },
  {
    value: "files",
    question: "Can Zenote understand images and files?",
    answer:
      "Zenote is designed to support images, documents, and audio when the selected model or processing path supports that format.",
  },
  {
    value: "free-plan",
    question: "Is there a free plan?",
    answer:
      "Yes. Zenote will include a Free plan alongside Plus and Pro options. Exact usage allowances are not locked yet.",
  },
  {
    value: "payments",
    question: "What payment methods are supported?",
    answer:
      "Zenote is being designed around PHP pricing and Philippine-friendly methods such as GCash, Maya, cards, and QRPh where payment-provider support is available.",
  },
  {
    value: "data",
    question: "How is my data handled?",
    answer:
      "Prompts, files, and responses may need to pass through selected AI providers to deliver the service. The final privacy policy will explain providers, retention, and user controls before launch.",
  },
]

const whyCopy =
  "Built for people who actually use AI. More room to work, powerful models, a familiar interface, and local-first details that make sense in the Philippines."

export default function HomePage() {
  return (
    <LandingMotion>
      <section className="reference-hero relative isolate mx-auto overflow-hidden rounded-b-[2rem] border-b border-primary/40 px-5 pt-16 pb-20 sm:px-8 sm:pt-20 sm:pb-24">
        <div
          aria-hidden="true"
          className="public-grid absolute inset-x-0 top-0 -z-10 h-[43rem] opacity-80"
        />
        <div
          aria-hidden="true"
          className="absolute top-28 left-1/2 -z-10 h-64 w-[min(70rem,130vw)] -translate-x-1/2 rounded-[100%] bg-primary/12 blur-[100px]"
        />
        <div className="mx-auto flex max-w-7xl flex-col items-center text-center">
          <p
            data-hero-reveal
            className="font-mono text-[11px] tracking-[0.18em] text-primary uppercase"
          >
            Powerful AI, without the tight limits
          </p>
          <h1
            data-hero-reveal
            className="mt-6 max-w-5xl text-[clamp(2.8rem,5.2vw,5rem)] leading-[1.06] font-medium tracking-[-0.055em] text-balance"
          >
            Your AI for <span className="text-primary">anything.</span>
          </h1>
          <p
            data-hero-reveal
            className="mt-5 max-w-lg text-sm leading-6 text-[#c1b3a9] sm:text-base sm:leading-7"
          >
            Chat, analyze files, work with images, reason through problems, and
            access powerful AI models from one place.
          </p>
          <HeroComposer />
        </div>
      </section>

      <section
        id="product"
        className="overflow-hidden px-3 pt-20 pb-20 sm:px-8 sm:pt-24 sm:pb-28"
      >
        <div className="relative mx-auto max-w-7xl before:absolute before:inset-x-0 before:bottom-[-4rem] before:-z-10 before:h-40 before:bg-primary/18 before:blur-[90px]">
          <ProductPreview />
        </div>
      </section>

      <section
        data-section-reveal
        className="border-y border-border/80 bg-[#0f0e0d] px-5 py-28 sm:px-8 sm:py-36"
      >
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <h2 className="text-4xl leading-tight font-semibold tracking-[-0.055em] sm:text-6xl">
              One clear place to think, make, and understand.
            </h2>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {capabilities.map((capability) => (
              <article
                key={capability.title}
                className="copper-card group rounded-xl p-6"
              >
                <div className="mb-8 grid size-10 place-items-center rounded-lg border border-white/10 bg-white/5 shadow-[inset_0_1px_0_#ffffff0a]">
                  <capability.icon className="size-4 text-[#f6d2b5]" />
                </div>
                <h3 className="text-lg font-medium tracking-[-0.03em]">
                  {capability.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {capability.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="models"
        data-section-reveal
        className="px-5 py-28 sm:px-8 sm:py-40"
      >
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
            <h2 className="max-w-xl text-5xl leading-[0.98] font-semibold tracking-[-0.065em] sm:text-7xl">
              One place. Powerful models.
            </h2>
            <p className="max-w-xl text-lg leading-8 text-muted-foreground lg:justify-self-end">
              Choose the intelligence that fits the work. Zenote keeps the
              experience consistent while the best model for the task can
              change.
            </p>
          </div>
          <div className="mt-20 overflow-hidden rounded-[1.2rem] border border-border/80 bg-card/60 px-6 py-7 sm:px-10 sm:py-10">
            <div className="flex flex-wrap items-center justify-center gap-5 font-mono text-xl text-muted-foreground sm:gap-8 sm:text-3xl">
              <span className="rounded-full border border-primary/35 bg-primary/10 px-4 py-2 text-foreground">
                GPT
              </span>
              <span>Claude</span>
              <span className="text-border">/</span>
              <span>Gemini</span>
              <span className="text-border">/</span>
              <span>DeepSeek</span>
              <span className="text-primary">+ more</span>
            </div>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Model availability may vary by plan and launch readiness.
          </p>
        </div>
      </section>

      <section
        data-section-reveal
        className="relative overflow-hidden bg-[#15100d] px-5 py-28 text-foreground sm:px-8 sm:py-40"
      >
        <div className="mx-auto grid max-w-7xl gap-16 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <h2 className="max-w-xl text-5xl leading-[0.98] font-semibold tracking-[-0.065em] sm:text-7xl">
              Drop something in. Ask anything about it.
            </h2>
            <p className="mt-7 max-w-lg text-lg leading-8 text-muted-foreground">
              Use the right kind of understanding for the file in front of you,
              without changing how you talk to Zenote.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              {
                icon: ImageIcon,
                label: "Image",
                example: "Explain this screenshot.",
              },
              {
                icon: FileTextIcon,
                label: "PDF",
                example: "Summarize this report.",
              },
              {
                icon: LayersIcon,
                label: "Document",
                example: "Find the key decisions.",
              },
              {
                icon: FileAudioIcon,
                label: "Audio",
                example: "Transcribe and summarize.",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="copper-card group min-h-44 rounded-xl p-5 sm:p-7"
              >
                <item.icon className="size-5 text-primary transition-transform duration-500 group-hover:scale-110" />
                <p className="mt-14 font-mono text-xs text-muted-foreground uppercase">
                  {item.label}
                </p>
                <p className="mt-2 text-base">{item.example}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-32 sm:px-8 sm:py-48">
        <div className="mx-auto max-w-7xl">
          <p
            data-why-copy
            className="max-w-6xl text-[clamp(2.5rem,6vw,5.5rem)] leading-[1.02] font-semibold tracking-[-0.065em]"
          >
            {whyCopy.split(" ").map((word, index) => (
              <span
                key={`${word}-${index}`}
                data-why-word
                className="mr-[0.22em] inline-block"
              >
                {word}
              </span>
            ))}
          </p>
          <div className="mt-16 grid gap-8 border-t pt-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [
                "More room to work",
                "Usage designed for real sessions, not constant interruption.",
              ],
              [
                "Powerful models",
                "Strong options through one familiar product.",
              ],
              [
                "Simple by design",
                "A quiet interface that keeps the conversation central.",
              ],
              [
                "Built for the Philippines",
                "PHP pricing and practical local payments where supported.",
              ],
            ].map(([title, description]) => (
              <div key={title}>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="pricing"
        data-section-reveal
        className="border-y border-border/80 bg-[#0f0e0d] px-5 py-28 sm:px-8 sm:py-40"
      >
        <div className="mx-auto max-w-7xl">
          <div className="mb-14 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-5xl font-semibold tracking-[-0.06em] sm:text-7xl">
                Room to do more.
              </h2>
              <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">
                Start free. Move up when you need more models and more capacity.
              </p>
            </div>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              Compare plans <ArrowRightIcon className="size-4" />
            </Link>
          </div>
          <Pricing />
        </div>
      </section>

      <section data-section-reveal className="px-5 py-28 sm:px-8 sm:py-40">
        <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[0.75fr_1.25fr]">
          <div>
            <h2 className="text-5xl font-semibold tracking-[-0.06em] sm:text-6xl">
              Useful answers.
            </h2>
            <p className="mt-5 max-w-sm text-base leading-7 text-muted-foreground">
              What we know now, without pretending launch details are final.
            </p>
          </div>
          <Accordion className="border-t">
            {faqs.map((faq) => (
              <AccordionItem key={faq.value} value={faq.value}>
                <AccordionTrigger className="py-5 text-base hover:no-underline">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="max-w-2xl pb-6 text-sm leading-7 text-muted-foreground">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      <section data-section-reveal className="px-5 pb-28 sm:px-8 sm:pb-40">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-10 rounded-[1.2rem] border border-primary/20 bg-[radial-gradient(ellipse_at_75%_20%,rgba(242,106,33,.18),transparent_45%),#15110e] p-7 sm:flex-row sm:items-end sm:p-12">
          <h2 className="max-w-4xl text-5xl leading-[0.98] font-semibold tracking-[-0.065em] sm:text-7xl lg:text-8xl">
            What will you do with Zenote?
          </h2>
          <Button
            size="lg"
            nativeButton={false}
            render={<Link href="/login" />}
          >
            Start chatting
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      </section>
    </LandingMotion>
  )
}
