"use client"

import Link from "next/link"
import { useSyncExternalStore } from "react"
import { MenuIcon } from "lucide-react"

import { ZenoteLogo } from "@/components/zenote-logo"
import { Button } from "@/components/ui/button"
import { UserMenu } from "@/components/user-menu"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

const navigation = [
  { href: "/#product", label: "Product" },
  { href: "/#models", label: "Models" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
]

function subscribeToScroll(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true })
  return () => window.removeEventListener("scroll", onChange)
}

function getScrollSnapshot() {
  return window.scrollY > 40
}

function getServerSnapshot() {
  return false
}

export function Navbar({
  user,
}: {
  user?: { name: string; email: string } | null
}) {
  const isScrolled = useSyncExternalStore(
    subscribeToScroll,
    getScrollSnapshot,
    getServerSnapshot
  )

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 h-15">
      <div
        className="public-navbar pointer-events-auto"
        data-scrolled={isScrolled}
      >
        <div className="public-navbar-content mx-auto flex max-w-7xl items-center justify-between px-5 sm:px-6 md:grid md:grid-cols-[1fr_auto_1fr] md:gap-5">
          <Link
            href="/"
            className="flex w-fit items-center gap-2.5 text-base font-semibold tracking-[-0.04em] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ZenoteLogo className="size-5 text-primary" />
            Zenote
          </Link>

          <nav
            aria-label="Primary navigation"
            className="hidden items-center gap-7 md:flex"
          >
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-[13px] text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-2 justify-self-end md:flex">
            {user ? (
              <>
                <Button nativeButton={false} render={<Link href="/chat" />}>
                  Open Zenote
                </Button>
                <UserMenu user={user} />
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  nativeButton={false}
                  render={<Link href="/login" />}
                >
                  Sign in
                </Button>
                <Button
                  className="shadow-[0_0_24px_-8px_rgba(242,106,33,.72)]"
                  nativeButton={false}
                  render={<Link href="/signup" />}
                >
                  Try Zenote
                </Button>
              </>
            )}
          </div>

          {user && (
            <div className="ml-auto md:hidden">
              <UserMenu user={user} />
            </div>
          )}

          <Sheet>
            <SheetTrigger
              render={
                <Button variant="ghost" size="icon" className="md:hidden" />
              }
            >
              <MenuIcon />
              <span className="sr-only">Open navigation</span>
            </SheetTrigger>
            <SheetContent className="w-[min(22rem,88vw)] border-l-border bg-popover">
              <SheetHeader className="border-b">
                <SheetTitle>Zenote</SheetTitle>
                <SheetDescription>Your AI for anything.</SheetDescription>
              </SheetHeader>
              <nav
                aria-label="Mobile navigation"
                className="flex flex-col px-4 py-3"
              >
                {navigation.map((item) => (
                  <SheetClose
                    key={item.href}
                    nativeButton={false}
                    render={
                      <Link
                        href={item.href}
                        className="border-b py-4 text-lg font-medium last:border-b-0"
                      />
                    }
                  >
                    {item.label}
                  </SheetClose>
                ))}
              </nav>
              <div className="mt-auto grid gap-2 border-t p-4">
                <SheetClose
                  nativeButton={false}
                  render={
                    <Button
                      variant="outline"
                      nativeButton={false}
                      render={<Link href={user ? "/chat" : "/login"} />}
                    />
                  }
                >
                  {user ? "Open Zenote" : "Sign in"}
                </SheetClose>
                {!user && (
                  <SheetClose
                    nativeButton={false}
                    render={
                      <Button
                        nativeButton={false}
                        render={<Link href="/signup" />}
                      />
                    }
                  >
                    Create account
                  </SheetClose>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}
