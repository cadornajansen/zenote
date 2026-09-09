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
  title: {
    default: "Zenote | Your AI for anything",
    template: "%s | Zenote",
  },
  description:
    "Chat, analyze files, work with images, and access powerful AI models from one place.",
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
