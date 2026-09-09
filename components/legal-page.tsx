type LegalSection = {
  title: string
  paragraphs: readonly string[]
}

type LegalPageProps = {
  title: string
  description: string
  lastUpdated: string
  sections: readonly LegalSection[]
}

export function LegalPage({
  title,
  description,
  lastUpdated,
  sections,
}: LegalPageProps) {
  return (
    <article className="relative overflow-hidden px-5 pt-24 pb-28 sm:px-8 sm:pt-32 sm:pb-40">
      <div
        aria-hidden="true"
        className="public-grid absolute inset-x-0 top-0 -z-10 h-[28rem] opacity-45"
      />
      <div className="mx-auto max-w-7xl">
        <header className="max-w-5xl border-b border-border/80 pb-14">
          <p className="font-mono text-xs tracking-[0.16em] text-primary uppercase">
            Legal
          </p>
          <h1 className="mt-6 text-[clamp(3.5rem,8vw,7rem)] leading-[0.94] font-semibold tracking-[-0.075em]">
            {title}
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-muted-foreground">
            {description}
          </p>
          <p className="mt-6 font-mono text-xs text-muted-foreground">
            Last updated: {lastUpdated}
          </p>
        </header>

        <div className="mt-8 max-w-3xl border-l-2 border-primary bg-primary/8 px-5 py-4 text-sm leading-6 text-accent-foreground">
          This is a pre-launch draft provided for transparency. It requires
          professional legal review before Zenote launches publicly.
        </div>

        <div className="mt-20 grid gap-12 lg:grid-cols-[14rem_1fr] lg:gap-24">
          <aside className="hidden lg:block">
            <p className="sticky top-28 text-sm leading-6 text-muted-foreground">
              Clear terms matter when conversations and files may be processed
              by third-party AI services.
            </p>
          </aside>
          <div className="max-w-3xl">
            {sections.map((section, index) => (
              <section
                key={section.title}
                className="border-t py-10 first:border-t-0 first:pt-0"
              >
                <h2 className="text-2xl font-semibold tracking-[-0.035em]">
                  {index + 1}. {section.title}
                </h2>
                <div className="mt-5 space-y-4 text-base leading-7 text-muted-foreground">
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </article>
  )
}
