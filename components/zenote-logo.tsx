import { cn } from "@/lib/utils"

type ZenoteLogoProps = {
  className?: string
  decorative?: boolean
}

export function ZenoteLogo({ className, decorative = true }: ZenoteLogoProps) {
  return (
    <svg
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : "Zenote"}
      className={cn("shrink-0 text-current", className)}
      fill="none"
      role={decorative ? undefined : "img"}
      viewBox="0 0 256 256"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M168 176c0 44.183-35.817 80-80 80h-8c-44.183 0-80-35.817-80-80zm88 0c0 44.183-35.817 80-80 80v-80zM84 0c46.392 0 84 37.608 84 84s-37.608 84-84 84S0 130.392 0 84 37.608 0 84 0m92 0c44.183 0 80 35.817 80 80v8c0 44.183-35.817 80-80 80z"
        fill="currentColor"
      />
    </svg>
  )
}
