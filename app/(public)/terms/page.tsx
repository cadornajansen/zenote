import type { Metadata } from "next"

import { LegalPage } from "@/components/legal-page"

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Pre-launch draft terms for the Zenote AI chat service.",
}

const sections = [
  {
    title: "Acceptance",
    paragraphs: [
      "By accessing Zenote after launch, you agree to the final Terms of Service and Privacy Policy presented at that time. If you do not agree, do not use the service.",
    ],
  },
  {
    title: "Eligibility",
    paragraphs: [
      "Users must meet the minimum legal age and other eligibility requirements stated in the final terms. A parent or guardian may need to consent where applicable law requires it.",
    ],
  },
  {
    title: "Accounts",
    paragraphs: [
      "You are responsible for accurate account information, protecting your credentials, and activity under your account. Notify Zenote promptly if you believe your account has been compromised.",
    ],
  },
  {
    title: "Zenote service",
    paragraphs: [
      "Zenote provides access to AI chat, selected models, conversation history, and supported multimodal inputs according to the features and limits available on your plan. Features may change as providers, safety requirements, and product needs evolve.",
    ],
  },
  {
    title: "AI-generated content",
    paragraphs: [
      "AI output can be incomplete, inaccurate, or inappropriate. You are responsible for reviewing output before relying on it, especially for legal, medical, financial, safety-critical, or other high-impact decisions.",
    ],
  },
  {
    title: "Acceptable use",
    paragraphs: [
      "You may not use Zenote to violate law, infringe rights, distribute malware, compromise systems, evade safeguards, abuse provider resources, or create material that the final acceptable-use rules prohibit.",
    ],
  },
  {
    title: "Plans and billing",
    paragraphs: [
      "Paid plans, PHP prices, billing periods, renewal behavior, supported payment methods, taxes, cancellation, and refund terms will be disclosed before purchase. Final plan details are not established by this draft page.",
    ],
  },
  {
    title: "Usage limits",
    paragraphs: [
      "Plans may include model-specific, message, credit, rate, or fair-use limits. Zenote may enforce limits needed to protect reliability, control provider costs, and prevent abuse, subject to the plan terms shown to users.",
    ],
  },
  {
    title: "Intellectual property",
    paragraphs: [
      "Zenote and its original software, design, branding, and documentation are protected by applicable intellectual-property laws. Rights in user inputs and AI outputs will be addressed in the final terms, subject to law and provider terms.",
    ],
  },
  {
    title: "Third-party providers",
    paragraphs: [
      "Zenote relies on third parties for hosting, AI processing, storage, payments, analytics, monitoring, and email. Their services may affect availability and may be governed by additional terms or privacy practices.",
    ],
  },
  {
    title: "Disclaimers",
    paragraphs: [
      "The final terms will state the warranties and disclaimers permitted by applicable law. Zenote cannot guarantee that AI output is accurate, that every model remains available, or that the service will always be uninterrupted.",
    ],
  },
  {
    title: "Termination",
    paragraphs: [
      "Users may be able to close their accounts according to the final account controls. Zenote may suspend or terminate access for serious or repeated violations, legal requirements, security risk, nonpayment, or harmful use.",
    ],
  },
  {
    title: "Changes",
    paragraphs: [
      "Zenote may update its terms as the service changes. Material updates will be communicated as required by law, and the effective date will be displayed clearly.",
    ],
  },
  {
    title: "Contact",
    paragraphs: [
      "Zenote will publish an official support and legal contact channel before public launch. This draft should not be treated as the final method for delivering formal notices.",
    ],
  },
] as const

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      description="The rules that will govern access to and use of Zenote."
      lastUpdated="September 9, 2026"
      sections={sections}
    />
  )
}
