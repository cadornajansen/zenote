"use client"

import { useRef, type ReactNode } from "react"
import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"

gsap.registerPlugin(useGSAP, ScrollTrigger)

export function LandingMotion({ children }: { children: ReactNode }) {
  const scope = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return
      }

      gsap.from("[data-hero-reveal]", {
        opacity: 0,
        y: 24,
        duration: 0.8,
        stagger: 0.1,
        ease: "power3.out",
      })

      gsap.fromTo(
        "[data-product-preview]",
        { opacity: 0, scale: 0.975, y: 32 },
        {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: 0.9,
          ease: "power3.out",
          scrollTrigger: {
            trigger: "[data-product-preview]",
            start: "top 84%",
            once: true,
          },
        }
      )

      gsap.utils
        .toArray<HTMLElement>("[data-section-reveal]")
        .forEach((section) => {
          gsap.from(section, {
            opacity: 0,
            y: 28,
            duration: 0.7,
            ease: "power2.out",
            scrollTrigger: {
              trigger: section,
              start: "top 84%",
              once: true,
            },
          })
        })

      gsap.from("[data-why-word]", {
        opacity: 0,
        y: 14,
        stagger: 0.028,
        duration: 0.5,
        ease: "power2.out",
        scrollTrigger: {
          trigger: "[data-why-copy]",
          start: "top 78%",
          once: true,
        },
      })
    },
    { scope }
  )

  return <div ref={scope}>{children}</div>
}
