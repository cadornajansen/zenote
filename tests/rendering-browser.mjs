// Local harness: temporarily mount tests/fixtures/response-preview.tsx at /render-test.
// Supply PLAYWRIGHT_MODULE when Playwright is installed outside this workspace.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { partialMarkdown, markdownFixture } from "./fixtures/markdown.ts"

const require = createRequire(import.meta.url)
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright")
const url = process.env.RENDER_URL || "http://localhost:3107/render-test"
const server = process.env.RENDER_URL ? null : spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--port", "3107"], { stdio: "inherit" })
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(url)).ok) break } catch {}
    if (attempt > 90) throw new Error("Preview server did not start")
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })
  await page.goto(url)
  const fixture = page.getByRole("textbox", { name: "Markdown fixture" })
  const response = page.locator(".ai-response")
  await page.waitForSelector(".katex")
  assert.equal(await response.locator("h1").count(), 1)
  assert.equal(await response.locator("table").count(), 1)
  assert.equal(await response.locator("input[type=checkbox]").count(), 2)
  assert.ok(await response.locator("ul ul li").count() >= 2)
  assert.equal(await response.locator(".katex").count(), 4)
  assert.equal(await response.locator("script").count(), 0)
  assert.equal(await response.locator('a[href^="javascript:"]').count(), 0)
  assert.equal(await response.locator("pre").count(), 3)
  assert.ok(!(await response.innerText()).includes("```"))
  const copy = page.getByRole("button", { name: "Copy code", exact: true }).first()
  await copy.click()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'def hello(name: str) -> str:\n    return f"Hello, {name}"')
  await page.getByRole("button", { name: "Copied code", exact: true }).waitFor()
  await page.waitForTimeout(1900)
  await copy.focus()
  await page.keyboard.press("Enter")
  await page.getByRole("button", { name: "Copied code", exact: true }).waitFor()
  await page.getByRole("button", { name: "Copy", exact: true }).click()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), markdownFixture)

  const long = '```typescript\nconst long = "' + "long-".repeat(100) + '"\n```\n\n| A | B |\n| --- | --- |\n| ' + "Column ".repeat(80) + ' | value |\n\n' + String.raw`\[\underbrace{x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x+x}_{\text{long equation}}\]`
  await fixture.fill(long)
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(500)
    const dimensions = await response.evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth, body: document.body.scrollWidth, viewport: window.innerWidth }))
    assert.ok(dimensions.scroll <= dimensions.width + 1, JSON.stringify(dimensions))
    assert.ok(dimensions.body <= dimensions.viewport, JSON.stringify(dimensions))
    assert.equal(await response.locator("pre").evaluate((element) => getComputedStyle(element).whiteSpace), "pre")
    assert.ok(await response.locator("pre").evaluate((element) => element.scrollWidth > element.clientWidth))
  }
  await page.getByRole("checkbox", { name: "Streaming" }).check()
  for (const partial of partialMarkdown) {
    await fixture.fill(partial)
    await page.waitForTimeout(150)
    assert.ok(!(await response.innerText()).includes("```"), partial)
    if (partial.startsWith("```")) assert.equal(await page.getByRole("button", { name: "Copy code" }).isDisabled(), true)
  }
  await fixture.fill("```py\ndef hello(")
  await page.getByRole("checkbox", { name: "Streaming" }).uncheck()
  assert.equal(await response.locator("pre").count(), 1)
  await fixture.fill(markdownFixture)
  await page.waitForTimeout(700)
  await page.screenshot({ path: process.env.RENDER_SCREENSHOT || "C:/Users/DDCic/AppData/Local/Temp/opencode/zenote-markdown-mobile.png", fullPage: true })
  assert.deepEqual(errors, [])
  console.info("PASS: Markdown, math, XSS safety, copy/keyboard, 1280/390/320px containment, partial/interrupted streaming; no browser errors")
} finally {
  await browser?.close()
  server?.kill()
}
