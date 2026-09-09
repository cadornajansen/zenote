import { Footer } from "@/components/footer"
import { Navbar } from "@/components/navbar"
import { getCurrentUser } from "@/lib/auth"

export default async function PublicLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const user = await getCurrentUser()

  return (
    <div className="min-h-svh overflow-x-hidden pt-15">
      <Navbar user={user} />
      <main>{children}</main>
      <Footer />
    </div>
  )
}
