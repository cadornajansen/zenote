import type { Metadata } from "next"

import { LegalPage } from "@/components/legal-page"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "A pre-launch draft explaining how Zenote plans to handle account data, conversations, files, and AI provider processing.",
}

const sections = [
  {
    title: "Information we collect",
    paragraphs: [
      "When Zenote launches account features, we may collect profile details, account identifiers, conversations, prompts, uploaded files, model selections, usage records, subscription status, and technical information needed to operate and secure the service.",
      "We will collect only the information reasonably needed to provide, improve, bill, and protect Zenote.",
    ],
  },
  {
    title: "How we use information",
    paragraphs: [
      "We may use information to provide AI responses, maintain conversation history, enforce usage limits, process subscriptions, support users, prevent abuse, diagnose errors, and understand product performance.",
    ],
  },
  {
    title: "AI provider processing",
    paragraphs: [
      "Prompts, conversation context, and supported attachments may be sent to selected third-party AI or processing providers to generate a response. The provider may vary based on the model and capability selected in Zenote.",
      "Before launch, Zenote will publish the applicable providers and material processing terms. We will not describe infrastructure providers as customer-facing model choices.",
    ],
  },
  {
    title: "Files and conversations",
    paragraphs: [
      "Zenote is designed to store conversation history and user attachments so people can continue their work. Access controls, supported formats, deletion behavior, and retention periods will be finalized before these features launch.",
    ],
  },
  {
    title: "Payments",
    paragraphs: [
      "Payment information will be processed by an approved payment provider. Zenote should receive only the payment and subscription details needed to manage access, receipts, refunds, and billing support, rather than storing full card credentials.",
    ],
  },
  {
    title: "Analytics and diagnostics",
    paragraphs: [
      "Zenote plans to use limited product analytics and error monitoring to understand feature use and diagnose failures. The final policy will identify active tools, data collected, and available controls.",
    ],
  },
  {
    title: "Data retention",
    paragraphs: [
      "Information will be retained only as long as needed for the service, legal obligations, security, dispute resolution, and legitimate business purposes. Specific retention periods and deletion workflows will be documented before launch.",
    ],
  },
  {
    title: "Security",
    paragraphs: [
      "Zenote will use reasonable technical and organizational safeguards appropriate to the nature of the information it handles. No internet service can promise absolute security.",
    ],
  },
  {
    title: "Your rights",
    paragraphs: [
      "Depending on applicable law, users may have rights to access, correct, export, restrict, object to, or delete personal information. The final policy will explain how verified requests can be submitted.",
    ],
  },
  {
    title: "Contact",
    paragraphs: [
      "Zenote will publish a dedicated privacy contact channel before public launch. This draft should not be treated as the final method for submitting a legal request.",
    ],
  },
] as const

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      description="How Zenote plans to handle account data, conversations, files, and provider processing."
      lastUpdated="September 9, 2026"
      sections={sections}
    />
  )
}
