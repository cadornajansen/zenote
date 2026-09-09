// Normalize model-style LaTeX delimiters without rewriting literal code examples.
export function normalizeMath(markdown: string): string {
  let fence = ""
  let inline = ""
  return markdown.split("\n").map((line) => {
    const marker = line.match(/^[\t ]*(?:> ?)*(`{3,}|~{3,})/)
    if (marker && !inline) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length &&
        line.slice(marker[0].length).trim() === "") fence = ""
      return line
    }
    if (fence || (!inline && /^( {4}|\t)/.test(line))) return line
    let result = ""
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "`") {
        const start = i
        while (line[i + 1] === "`") i++
        const ticks = line.slice(start, i + 1)
        if (!inline) inline = ticks
        else if (inline === ticks) inline = ""
        result += ticks
      } else if (!inline && line[i] === "\\" && i + 1 < line.length) {
        const next = line[++i]
        result += next === "(" || next === ")" ? "$"
          : next === "[" ? "\n$$\n"
          : next === "]" ? "\n$$\n" : `\\${next}`
      } else result += line[i]
    }
    return result
  }).join("\n")
}
