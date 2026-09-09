import assert from "node:assert/strict"
import { test } from "node:test"
import { normalizeMath } from "../lib/markdown.ts"
import { markdownFixture } from "./fixtures/markdown.ts"
import { createCodePlugin } from "@streamdown/code"

test("normalizes both model LaTeX delimiters and preserves dollar math", () => {
  assert.equal(normalizeMath(String.raw`\(E=mc^2\)`), "$E=mc^2$")
  assert.equal(normalizeMath(String.raw`\[E=mc^2\]`), "\n$$\nE=mc^2\n$$\n")
  assert.equal(normalizeMath("$E=mc^2$\n$$\nx\n$$"), "$E=mc^2$\n$$\nx\n$$")
  assert.ok(normalizeMath(markdownFixture).includes("$$"))
})

test("literal delimiters in complete/incomplete fenced and inline code are unchanged", () => {
  for (const value of [
    "```python\n\\[x\\]\n```\n",
    "~~~text\n\\(x\\)\n~~~",
    "```py\n\\[",
    "`\\(x\\)` and ``\\[x\\]``",
    "    \\[literal\\]",
    String.raw`\\[escaped\\]`,
    "> ```text\n> \\[x\\]\n> ```",
  ]) assert.equal(normalizeMath(value), value)
})

test("Shiki resolves all requested grammars and rejects unknown identifiers safely", async () => {
  const code = createCodePlugin({ themes: ["github-dark", "github-dark"] })
  for (const language of ["javascript", "typescript", "jsx", "tsx", "python", "java", "c", "cpp", "csharp", "go", "rust", "php", "ruby", "swift", "kotlin", "dart", "html", "css", "scss", "json", "yaml", "toml", "sql", "bash", "powershell", "dockerfile", "markdown", "xml", "graphql"]) {
    assert.ok(code.supportsLanguage(language), language)
  }
  assert.equal(code.supportsLanguage("unknown-zenote-language"), false)
  const highlighted = await new Promise((resolve) => {
    const result = code.highlight({ code: "def hello():\n    return 42", language: "python", themes: code.getThemes() }, resolve)
    if (result) resolve(result)
  })
  assert.ok(new Set(highlighted.tokens.flat().map((token) => token.color ?? JSON.stringify(token.htmlStyle))).size > 1)
})
