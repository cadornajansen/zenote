"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { PurchaseType } from "@/lib/pricing"

type Activity = { transactions: Array<{ $id: string; amount: number; type: string; $createdAt: string }>; usage: Array<{ $id: string; actualModel?: string; creditsCharged: number; $createdAt: string }>; purchases: Array<{ $id: string; type: string; amountPhpCentavos: number; credits: number; status: string; $createdAt: string }> }

type CatalogOffer = { type: PurchaseType; label: string; amountPhpCentavos: number; credits: number }
type Catalog = { payg: CatalogOffer[]; packs: CatalogOffer[]; modelRates: Array<{ id: string; name: string; credits: number }> }

export function CreditsPanel({ summary, activity, catalog }: { summary: { freeCredits: number; purchasedCredits: number; totalCredits: number; monthlyAllocation: number }; activity: Activity; catalog: Catalog }) {
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState<string>()
  async function checkout(type: PurchaseType, amountPhpCentavos?: number) {
    const key = `${type}:${amountPhpCentavos ?? ""}`
    setLoading(key); setError(undefined)
    try {
      const response = await fetch("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, amountPhpCentavos }) })
      const result = await response.json()
      if (!response.ok || !result.checkoutUrl) throw new Error(result.error ?? "Checkout could not be created.")
      window.location.assign(result.checkoutUrl)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Checkout could not be created.") }
    finally { setLoading(undefined) }
  }
  return <section className="border-t border-border/80 py-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-sm font-medium">Zenote Credits</p><p className="mt-2 text-3xl font-semibold tracking-[-0.04em]">{summary.totalCredits.toLocaleString()} credits</p><p className="mt-2 text-sm text-muted-foreground">Free this month: {summary.freeCredits.toLocaleString()} / {summary.monthlyAllocation.toLocaleString()} · Purchased: {summary.purchasedCredits.toLocaleString()}</p></div>
    </div>
    <p className="mt-5 text-sm text-muted-foreground">Credits are used when Zenote generates AI responses. More capable models use more credits.</p>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    <div className="mt-5 grid gap-3 sm:grid-cols-3">
      {catalog.payg.map((offer) => <Card key={offer.amountPhpCentavos} className="border-border/80 bg-card"><CardContent className="p-4"><p className="font-medium">₱{offer.amountPhpCentavos / 100}</p><p className="mt-1 text-sm text-muted-foreground">{offer.credits.toLocaleString()} credits</p><Button className="mt-4 w-full" size="sm" variant="secondary" disabled={!!loading} onClick={() => checkout("payg", offer.amountPhpCentavos)}>{loading === `payg:${offer.amountPhpCentavos}` ? "Opening…" : "Add credits"}</Button></CardContent></Card>)}
    </div>
    <p className="mt-7 text-xs font-medium tracking-[0.12em] text-muted-foreground">PACKS</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      {catalog.packs.map((pack) => <Card key={pack.type} className="border-border/80 bg-card"><CardContent className="p-4"><p className="font-medium">{pack.label}</p><p className="mt-1 text-sm text-muted-foreground">₱{pack.amountPhpCentavos / 100} · {pack.credits.toLocaleString()} credits</p><Button className="mt-4 w-full" size="sm" variant="secondary" disabled={!!loading} onClick={() => checkout(pack.type)}>{loading === `${pack.type}:` ? "Opening…" : "Select"}</Button></CardContent></Card>)}
    </div>
    <p className="mt-5 text-xs text-muted-foreground">Zenote Credits are non-transferable service credits with no cash value.</p>
    <div className="mt-7 grid gap-6 border-t border-border/80 pt-5 sm:grid-cols-2"><div><p className="text-sm font-medium">Recent usage</p>{activity.usage.slice(0, 4).map((item) => <p key={item.$id} className="mt-2 text-sm text-muted-foreground">{item.actualModel ?? "Zenote"} <span className="float-right text-foreground">-{item.creditsCharged}</span></p>) || <p className="mt-2 text-sm text-muted-foreground">No usage yet.</p>}</div><div><p className="text-sm font-medium">Model rates</p>{catalog.modelRates.map((item) => <p key={item.id} className="mt-2 text-sm text-muted-foreground">{item.name}<span className="float-right text-foreground">{item.credits}</span></p>)}</div></div>
  </section>
}
