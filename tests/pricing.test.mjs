import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { test } from "node:test"
import ts from "typescript"

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) return { url: new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith(".ts")) return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText }
    return next(url, context)
  },
})

const { CREDIT_PACKS, modelCreditWeight, resolvePurchaseOffer } = await import("../lib/pricing.ts")

test("model credit weights are centralized and complete", () => {
  assert.equal(modelCreditWeight("gpt-5-mini"), 1)
  assert.equal(modelCreditWeight("gpt-5-6-sol"), 5)
  assert.equal(modelCreditWeight("claude-opus-5"), 6)
  assert.throws(() => modelCreditWeight("unknown"))
})

test("server-side purchase catalogue rejects client credit manipulation", () => {
  assert.deepEqual(CREDIT_PACKS.map(({ amountPhpCentavos, credits }) => [amountPhpCentavos, credits]), [[29900, 1350], [69900, 3500], [149900, 8000]])
  assert.deepEqual(resolvePurchaseOffer({ type: "payg", amountPhpCentavos: 5000 }), { type: "payg", label: "Pay as you go", amountPhpCentavos: 5000, credits: 200 })
  assert.throws(() => resolvePurchaseOffer({ type: "payg", amountPhpCentavos: 5100 }))
  assert.throws(() => resolvePurchaseOffer({ type: "payg", amountPhpCentavos: 4900 }))
})
