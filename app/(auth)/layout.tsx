export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <main className="relative grid min-h-svh place-items-center overflow-hidden px-4 py-4 sm:px-6">
      <div
        aria-hidden="true"
        className="public-grid absolute inset-0 -z-10 opacity-45"
      />
      <div
        aria-hidden="true"
        className="absolute top-[-12rem] left-1/2 -z-10 h-96 w-2xl -translate-x-1/2 rounded-full bg-primary/12 blur-[120px]"
      />
      {children}
    </main>
  )
}
