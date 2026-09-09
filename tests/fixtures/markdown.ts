export const markdownFixture = String.raw`# Heading

## Compact subheading

### Small heading

Normal **bold**, *italic*, ~~strike~~, and \`inline code\`.

> This is a blockquote with **nested Markdown**.
>
> A second paragraph, not another card.

- item
  - nested item
    - deeper item

1. first
2. second
   1. nested ordered

- [x] completed
- [ ] pending

| Language | Example |
| --- | --- |
| Python | \`print()\` |
| TypeScript | \`console.log()\` |

\`\`\`python
def hello(name: str) -> str:
    return f"Hello, {name}"
\`\`\`

\`\`\`typescript
interface User {
  id: string
  name: string
}
\`\`\`

Inline math: \(E = mc^2\) and $E = mc^2$.

\[
r_s = \frac{2GM}{c^2}
\]

$$
r_s = \frac{2GM}{c^2}
$$

---

[External link](https://example.com) and https://example.com/a/very/long/path/that/should/wrap/without/expanding/the/conversation/width.

\`\`\`unknown-zenote-language
literal <script>alert("not executed")</script>
  preserve indentation and \[ literal delimiters \]
\`\`\`

<script>alert("unsafe")</script>

[Unsafe link](javascript:alert%281%29)
`.replaceAll("\\`", "`")

export const partialMarkdown = [
  "**",
  "```py\ndef hello(",
  "| Model | Context |\n| --- | --- |\n| Python |",
  "- item\n  - nested",
  String.raw`\[\frac{2GM}{c^2}`,
  String.raw`Inline \(E = mc`,
  "$$\nr_s = \\frac{2GM}{",
]
