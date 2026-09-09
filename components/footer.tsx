import Link from "next/link"

import { ZenoteLogo } from "@/components/zenote-logo"

const footerLinks = [
  { href: "/about", label: "About" },
  { href: "/pricing", label: "Pricing" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
]

export function Footer() {
  return (
    <footer className="border-t border-border/80 bg-[#0d0c0b]">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 sm:px-8 md:grid-cols-[1fr_auto_auto] md:items-end">
        <div>
          <Link
            href="/"
            className="flex items-center gap-2.5 text-lg font-semibold tracking-[-0.04em]"
          >
            <ZenoteLogo className="size-5 text-primary" />
            Zenote
          </Link>
          <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
            Powerful AI, without the tight limits.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-muted-foreground">
          {footerLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} Zenote
        </p>
      </div>
    </footer>
  )
}
