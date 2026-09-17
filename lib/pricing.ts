import { getModel, models } from "@/lib/models"

export const CREDIT_CONFIG = {
  creditsPerPhp: () => integerEnv("ZENOTE_CREDITS_PER_PHP", 4),
  paygMinimumCentavos: () => integerEnv("ZENOTE_PAYG_MIN_CENTAVOS", 5_000),
  freeMonthlyCredits: () => integerEnv("ZENOTE_FREE_MONTHLY_CREDITS", 150),
} as const

export type PurchaseType = "payg" | "starter" | "power" | "max"
export type PurchaseOffer = {
  type: PurchaseType
  label: string
  amountPhpCentavos: number
  credits: number
}

export const CREDIT_PACKS: readonly PurchaseOffer[] = [
  { type: "starter", label: "Starter", amountPhpCentavos: 29_900, credits: 1_350 },
  { type: "power", label: "Power", amountPhpCentavos: 69_900, credits: 3_500 },
  { type: "max", label: "Max", amountPhpCentavos: 149_900, credits: 8_000 },
]

export const PAYG_AMOUNTS_CENTAVOS = [5_000, 10_000, 20_000] as const

function integerEnv(key: string, fallback: number) {
  const raw = process.env[key] ?? String(fallback)
  const value = Number(raw)
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1)
    throw new Error(`Invalid commercial configuration: ${key}`)
  return value
}

export function modelCreditWeight(modelId: string) {
  const weight = getModel(modelId)?.creditWeight
  if (weight === undefined) throw new Error("Unknown credit-priced model")
  return weight
}

export function modelCreditRates() {
  return models.map((model) => ({ ...model, credits: model.creditWeight }))
}

export function resolvePurchaseOffer(input: { type: PurchaseType; amountPhpCentavos?: number }): PurchaseOffer {
  if (input.type !== "payg") {
    const pack = CREDIT_PACKS.find((item) => item.type === input.type)
    if (!pack) throw new Error("Invalid credit purchase.")
    return pack
  }
  const amount = input.amountPhpCentavos
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || !PAYG_AMOUNTS_CENTAVOS.includes(amount as never))
    throw new Error("Choose one of the available pay-as-you-go amounts.")
  if (amount < CREDIT_CONFIG.paygMinimumCentavos())
    throw new Error("Pay-as-you-go purchases start at ₱50.")
  return {
    type: "payg",
    label: "Pay as you go",
    amountPhpCentavos: amount,
    credits: (amount / 100) * CREDIT_CONFIG.creditsPerPhp(),
  }
}
