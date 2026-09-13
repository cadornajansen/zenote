import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { AppwriteStartupPing } from "@/components/appwrite-startup-ping"
import { cn } from "@/lib/utils"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Zenote | Your AI for anything",
    template: "%s | Zenote",
  },
  description:
    "Chat, analyze files, work with images, and access powerful AI models from one place.",
  applicationName: "Zenote",
  keywords: ["AI chat", "AI assistant", "file analysis", "image analysis"],
  alternates: { canonical: "/" },
  icons: {
    icon: [
      { url: "/favicon-16x16.svg", sizes: "16x16", type: "image/svg+xml" },
      { url: "/favicon-32x32.svg", sizes: "32x32", type: "image/svg+xml" },
      { url: "/icon-192x192.svg", sizes: "192x192", type: "image/svg+xml" },
      { url: "/icon-512x512.svg", sizes: "512x512", type: "image/svg+xml" },
    ],
    apple: { url: "/apple-touch-icon.svg", sizes: "180x180", type: "image/svg+xml" },
  },
  openGraph: {
    type: "website",
    siteName: "Zenote",
    title: "Zenote | Your AI for anything",
    description: "Chat, analyze files, work with images, and access powerful AI models from one place.",
    url: "/",
  },
  twitter: {
    card: "summary",
    title: "Zenote | Your AI for anything",
    description: "Chat, analyze files, work with images, and access powerful AI models from one place.",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "dark",
        "antialiased",
        fontMono.variable,
        "font-sans",
        geist.variable
      )}
      data-scroll-behavior="smooth"
    >
      <body>
        <AppwriteStartupPing />
        {children}
      </body>
    </html>
  )
}
