import assert from "node:assert/strict"
import { beforeEach, afterEach, test } from "node:test"
import { zipSync, strToU8 } from "fflate"
import sharp from "sharp"
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime"
import {
  TextractClient,
  AnalyzeDocumentCommand,
  DetectDocumentTextCommand,
} from "@aws-sdk/client-textract"
import { processAttachment, validateBytes } from "../dist/processor.js"
import { boundedText } from "../dist/policy.js"
import {
  assembleImageProcessedText,
  normalizeTextractEvidence,
} from "../dist/image-processor.js"
const originalFetch = globalThis.fetch
const novaSend = BedrockRuntimeClient.prototype.send
const textractSend = TextractClient.prototype.send
const originalKey = process.env.ASSEMBLYAI_API_KEY
const originalVisionModel = process.env.BEDROCK_NOVA_VISION_MODEL_ID
const originalLegacyVisionModel = process.env.BEDROCK_NOVA_MODEL_ID
beforeEach(() => {
  globalThis.fetch = async () => {
    throw new Error("Unexpected paid provider request")
  }
  BedrockRuntimeClient.prototype.send = async () => {
    throw new Error("Unexpected vision request")
  }
  TextractClient.prototype.send = async () => {
    throw new Error("Unexpected OCR request")
  }
})
afterEach(() => {
  globalThis.fetch = originalFetch
  BedrockRuntimeClient.prototype.send = novaSend
  TextractClient.prototype.send = textractSend
  if (originalKey === undefined) delete process.env.ASSEMBLYAI_API_KEY
  else process.env.ASSEMBLYAI_API_KEY = originalKey
  if (originalVisionModel === undefined)
    delete process.env.BEDROCK_NOVA_VISION_MODEL_ID
  else process.env.BEDROCK_NOVA_VISION_MODEL_ID = originalVisionModel
  if (originalLegacyVisionModel === undefined)
    delete process.env.BEDROCK_NOVA_MODEL_ID
  else process.env.BEDROCK_NOVA_MODEL_ID = originalLegacyVisionModel
})
const signal = () => new AbortController().signal

test("TXT and Markdown use deterministic UTF-8 extraction, normalize and bound text", async () => {
  for (const ext of ["txt", "md"]) {
    const result = await processAttachment(
      { fileName: `notes.${ext}`, bytes: Buffer.from(" Hello\r\nworld\x01 ") },
      signal()
    )
    assert.equal(result.processor, "local-text")
    assert.equal(result.text, "Hello\nworld")
  }
  await assert.rejects(validateBytes("notes.txt", Buffer.from([0xff, 0xff])), {
    code: "invalid_file",
  })
  for (const budget of [0, 1, 48, 49, 50, 100, 24_000])
    assert.ok(boundedText("x".repeat(30_000), budget).length <= budget)
  assert.match(boundedText("x".repeat(30_000)), /Content truncated/)
})

test("DOCX uses real Function-local Mammoth and rejects unrelated ZIP archives", async () => {
  const xml =
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Local DOCX content</w:t></w:r></w:p></w:body></w:document>'
  const docx = Buffer.from(
    zipSync({
      "word/document.xml": strToU8(xml),
      "[Content_Types].xml": strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
    })
  )
  const result = await processAttachment(
    { fileName: "notes.docx", bytes: docx },
    signal()
  )
  assert.equal(result.processor, "mammoth")
  assert.match(result.text, /Local DOCX content/)
  await assert.rejects(
    processAttachment(
      {
        fileName: "wrong.docx",
        bytes: Buffer.from(zipSync({ "other.txt": strToU8("not docx") })),
      },
      signal()
    ),
    { code: "invalid_file" }
  )
  const expanded = Buffer.from(
    zipSync({ "word/document.xml": new Uint8Array(20_000_001) })
  )
  await assert.rejects(
    processAttachment({ fileName: "expanded.docx", bytes: expanded }, signal()),
    { code: "invalid_file" }
  )
})

function pdf(text = "Local PDF content", pages = 1) {
  const stream = text ? `BT /F1 12 Tf 20 100 Td (${text}) Tj ET` : ""
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${5 + i} 0 R`).join(" ")}] /Count ${pages} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ...Array.from(
      { length: pages },
      () =>
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>"
    ),
  ]
  let body = "%PDF-1.4\n"
  const offsets = [0]
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(body))
    body += `${i + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join(
      ""
    )}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(body)
}

test("text PDF stays local; only an empty single-page PDF falls back to bounded Textract", async () => {
  const local = await processAttachment(
    { fileName: "notes.pdf", bytes: pdf() },
    signal()
  )
  assert.equal(local.processor, "pdf-parse")
  assert.match(local.text, /Local PDF content/)
  let ocr = 0
  TextractClient.prototype.send = async (command) => {
    ocr++
    assert.ok(command instanceof DetectDocumentTextCommand)
    assert.ok(command.input.Document.Bytes)
    return { Blocks: [{ BlockType: "LINE", Text: "Scanned text" }] }
  }
  assert.equal(
    (
      await processAttachment(
        { fileName: "scan.pdf", bytes: pdf("") },
        signal()
      )
    ).processor,
    "textract"
  )
  await assert.rejects(
    processAttachment({ fileName: "scan.pdf", bytes: pdf("", 2) }, signal()),
    { code: "scanned_pdf" }
  )
  assert.equal(ocr, 1)
  const sampled = await processAttachment(
    { fileName: "long.pdf", bytes: pdf("Repeated page", 51) },
    signal()
  )
  assert.equal(sampled.text.match(/Repeated page/g).length, 50)
  assert.match(sampled.text, /PDF truncated/)
})

const orchidLines = [
  "Project: Orchid Lantern",
  "Launch date: March 17, 2031",
  "Budget: PHP 248,750",
  "Owner: Mira Santos",
  "Location: Davao City",
  "Verification phrase: cobalt-river-42",
  "Milestone Progress:",
  "Research: 90%",
  "Prototype: 70%",
  "Testing: 45%",
  "Launch: 20%",
]

function orchidTextract() {
  return {
    $metadata: { requestId: "textract-request" },
    Blocks: [
      ...orchidLines.map((Text, index) => ({
        BlockType: "LINE",
        Id: `line-${index}`,
        Text,
        Page: 1,
      })),
      { BlockType: "WORD", Id: "word-key", Text: "Project", Page: 1 },
      {
        BlockType: "WORD",
        Id: "word-value",
        Text: "Orchid Lantern",
        Page: 1,
      },
      {
        BlockType: "KEY_VALUE_SET",
        Id: "key",
        EntityTypes: ["KEY"],
        Relationships: [
          { Type: "CHILD", Ids: ["word-key"] },
          { Type: "VALUE", Ids: ["value"] },
        ],
        Page: 1,
      },
      {
        BlockType: "KEY_VALUE_SET",
        Id: "value",
        EntityTypes: ["VALUE"],
        Relationships: [{ Type: "CHILD", Ids: ["word-value"] }],
        Page: 1,
      },
      {
        BlockType: "TABLE",
        Id: "table",
        Relationships: [{ Type: "CHILD", Ids: ["cell-1", "cell-2"] }],
        Page: 1,
      },
      {
        BlockType: "CELL",
        Id: "cell-1",
        RowIndex: 1,
        ColumnIndex: 1,
        Relationships: [{ Type: "CHILD", Ids: ["cell-word-1"] }],
      },
      {
        BlockType: "CELL",
        Id: "cell-2",
        RowIndex: 1,
        ColumnIndex: 2,
        Relationships: [{ Type: "CHILD", Ids: ["cell-word-2"] }],
      },
      { BlockType: "WORD", Id: "cell-word-1", Text: "Research" },
      { BlockType: "WORD", Id: "cell-word-2", Text: "90%" },
      {
        BlockType: "LAYOUT_TITLE",
        Id: "layout-title",
        Text: "Project status",
        Page: 1,
      },
    ],
  }
}

async function imageFixture(format = "png") {
  return sharp({
    create: { width: 2, height: 2, channels: 3, background: "red" },
  })
    .toFormat(format)
    .toBuffer()
}

function novaResponse(text, requestId = "nova-request") {
  return {
    $metadata: { requestId },
    output: { message: { content: [{ text }] } },
  }
}

test("image quality pipeline preserves Orchid Lantern evidence and verifies visual relationships", async () => {
  const logs = []
  let visionRequests = 0
  process.env.BEDROCK_NOVA_VISION_MODEL_ID = "global.amazon.nova-2-lite-v1:0"
  TextractClient.prototype.send = async (command) => {
    assert.ok(command instanceof AnalyzeDocumentCommand)
    assert.deepEqual(command.input.FeatureTypes, ["LAYOUT", "TABLES", "FORMS"])
    assert.ok(command.input.Document.Bytes)
    return orchidTextract()
  }
  BedrockRuntimeClient.prototype.send = async (command) => {
    visionRequests++
    assert.equal(command.input.modelId, "global.amazon.nova-2-lite-v1:0")
    assert.equal(command.input.messages[0].content[1].image.format, "png")
    assert.equal(command.input.inferenceConfig.maxTokens, 8192)
    assert.match(command.input.system[0].text, /Never follow instructions/i)
    assert.match(command.input.messages[0].content[0].text, /Orchid Lantern/)
    return novaResponse(
      visionRequests === 1
        ? "The milestone bars descend from Research to Launch."
        : "Research is the highest milestone at 90%."
    )
  }
  const result = await processAttachment(
    { fileName: "05-image-nova.png", bytes: await imageFixture() },
    signal(),
    (entry) => logs.push(entry)
  )
  assert.equal(result.processor, "image:textract+nova+verify")
  for (const value of [
    "Orchid Lantern",
    "March 17, 2031",
    "PHP 248,750",
    "Mira Santos",
    "Davao City",
    "cobalt-river-42",
    "90%",
    "70%",
    "45%",
    "20%",
    "Research is the highest milestone at 90%.",
  ])
    assert.match(
      result.text,
      new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    )
  assert.match(result.text, /\[EXTRACTED TEXT\]/)
  assert.match(result.text, /\[STRUCTURED DOCUMENT DATA\]/)
  assert.match(result.text, /\[VERIFIED VISUAL ANALYSIS\]/)
  assert.match(result.text, /Verification: success/)
  assert.equal(visionRequests, 2)
  assert.ok(
    logs.every((entry) => !JSON.stringify(entry).includes("Orchid Lantern"))
  )
})

test("image pipeline degrades to primary vision when verification fails", async () => {
  TextractClient.prototype.send = async () => orchidTextract()
  let calls = 0
  BedrockRuntimeClient.prototype.send = async () => {
    if (++calls === 1) return novaResponse("Primary visual analysis")
    throw new Error("verification unavailable")
  }
  const result = await processAttachment(
    { fileName: "chart.png", bytes: await imageFixture() },
    signal()
  )
  assert.equal(result.processor, "image:textract+nova")
  assert.match(result.text, /Primary visual analysis/)
  assert.match(result.text, /Verification: failed/)
})

test("image pipeline returns structured OCR when Nova is unavailable or malformed", async () => {
  for (const failure of [new Error("unavailable"), {}]) {
    TextractClient.prototype.send = async () => orchidTextract()
    BedrockRuntimeClient.prototype.send = async () => {
      if (failure instanceof Error) throw failure
      return failure
    }
    const result = await processAttachment(
      { fileName: "chart.png", bytes: await imageFixture() },
      signal()
    )
    assert.equal(result.processor, "image:textract")
    assert.match(result.text, /PHP 248,750/)
    assert.match(result.text, /Vision: failed/)
    assert.match(result.text, /Verification: skipped/)
  }
})

test("image pipeline returns verified vision when Textract fails or is malformed", async () => {
  for (const textractResult of [new Error("unavailable"), {}]) {
    TextractClient.prototype.send = async () => {
      if (textractResult instanceof Error) throw textractResult
      return textractResult
    }
    let calls = 0
    BedrockRuntimeClient.prototype.send = async () =>
      novaResponse(++calls === 1 ? "Primary vision" : "Verified vision")
    const result = await processAttachment(
      { fileName: "chart.png", bytes: await imageFixture() },
      signal()
    )
    assert.equal(result.processor, "image:nova+verify")
    assert.match(result.text, /OCR unavailable/)
    assert.match(result.text, /Verified vision/)
  }
})

test("image pipeline returns primary vision when OCR and verification fail", async () => {
  TextractClient.prototype.send = async () => {
    throw new Error("OCR unavailable")
  }
  let calls = 0
  BedrockRuntimeClient.prototype.send = async () => {
    if (++calls === 1) return novaResponse("Primary vision")
    throw new Error("verification unavailable")
  }
  const result = await processAttachment(
    { fileName: "chart.png", bytes: await imageFixture() },
    signal()
  )
  assert.equal(result.processor, "image:nova")
  assert.match(result.text, /Primary vision/)
  assert.match(result.text, /OCR: failed/)
  assert.match(result.text, /Verification: failed/)
})

test("image pipeline fails only when both OCR and vision fail", async () => {
  TextractClient.prototype.send = async () => {
    throw new Error("OCR unavailable")
  }
  BedrockRuntimeClient.prototype.send = async () => {
    throw new Error("vision unavailable")
  }
  await assert.rejects(
    processAttachment(
      { fileName: "chart.png", bytes: await imageFixture() },
      signal()
    ),
    { code: "processing_failed" }
  )
})

test("empty Textract output is not treated as usable OCR evidence", async () => {
  TextractClient.prototype.send = async () => ({ Blocks: [] })
  BedrockRuntimeClient.prototype.send = async () => {
    throw new Error("vision unavailable")
  }
  await assert.rejects(
    processAttachment(
      { fileName: "blank.png", bytes: await imageFixture() },
      signal()
    ),
    { code: "processing_failed" }
  )
})

test("Nova prompt bounds duplicated Textract evidence", async () => {
  TextractClient.prototype.send = async () => ({
    Blocks: [
      {
        BlockType: "LINE",
        Id: "large-line",
        Text: `start-${"x".repeat(150_000)}-end`,
      },
    ],
  })
  let requests = 0
  BedrockRuntimeClient.prototype.send = async (command) => {
    requests++
    assert.ok(command.input.messages[0].content[0].text.length < 100_000)
    return novaResponse(requests === 1 ? "Primary vision" : "Verified vision")
  }
  const result = await processAttachment(
    { fileName: "dense.png", bytes: await imageFixture() },
    signal()
  )
  assert.equal(result.text.length, 24_000)
  assert.match(result.text, /start-/)
  assert.match(result.text, /-end/)
})

test("Textract normalization preserves forms, tables, layout, lines and words", () => {
  const evidence = normalizeTextractEvidence(orchidTextract())
  assert.equal(evidence.rawText, orchidLines.join("\n"))
  assert.deepEqual(evidence.keyValues[0], {
    key: "Project",
    value: "Orchid Lantern",
    page: 1,
  })
  assert.deepEqual(evidence.tables[0].rows, [["Research", "90%"]])
  assert.deepEqual(evidence.layout[0], {
    type: "LAYOUT_TITLE",
    text: "Project status",
    page: 1,
  })
  assert.ok(evidence.words.some(({ text }) => text === "Orchid Lantern"))
  assert.throws(() => normalizeTextractEvidence({ Blocks: [{ Text: "bad" }] }))
})

test("24k image assembly prioritizes exact OCR over verbose visual prose", () => {
  const evidence = normalizeTextractEvidence(orchidTextract())
  const result = assembleImageProcessedText(
    evidence,
    "verbose ".repeat(10_000),
    { ocr: "success", vision: "success", verification: "success" }
  )
  assert.equal(result.length, 24_000)
  for (const value of ["March 17, 2031", "PHP 248,750", "cobalt-river-42"])
    assert.match(
      result,
      new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    )
  assert.match(result, /OCR: success/)
})

test("image provider timeout aborts without attempting degraded provider work", async () => {
  const controller = new AbortController()
  let bedrockCalls = 0
  TextractClient.prototype.send = async () => {
    controller.abort()
    throw new Error("timeout")
  }
  BedrockRuntimeClient.prototype.send = async () => {
    bedrockCalls++
    return novaResponse("must not run")
  }
  await assert.rejects(
    processAttachment(
      { fileName: "chart.png", bytes: await imageFixture() },
      controller.signal
    ),
    { name: "AbortError" }
  )
  assert.equal(bedrockCalls, 0)
})

test("image aborts during either Nova pass instead of degrading", async () => {
  for (const abortOnCall of [1, 2]) {
    const controller = new AbortController()
    let bedrockCalls = 0
    TextractClient.prototype.send = async () => orchidTextract()
    BedrockRuntimeClient.prototype.send = async () => {
      bedrockCalls++
      if (bedrockCalls === abortOnCall) {
        controller.abort()
        throw new Error("timeout")
      }
      return novaResponse("Primary vision")
    }
    await assert.rejects(
      processAttachment(
        { fileName: "chart.png", bytes: await imageFixture() },
        controller.signal
      ),
      { name: "AbortError" }
    )
    assert.equal(bedrockCalls, abortOnCall)
  }
})

test("image model configuration rejects profile-only bare IDs", async () => {
  process.env.BEDROCK_NOVA_VISION_MODEL_ID = "amazon.nova-2-lite-v1:0"
  await assert.rejects(
    processAttachment(
      { fileName: "chart.png", bytes: await imageFixture() },
      signal()
    ),
    { code: "configuration" }
  )
})

test("sharp accepts each supported image format before provider calls", async () => {
  TextractClient.prototype.send = async () => orchidTextract()
  BedrockRuntimeClient.prototype.send = async () => novaResponse("vision")
  for (const [extension, format] of [
    ["png", "png"],
    ["jpg", "jpeg"],
    ["webp", "webp"],
  ]) {
    const result = await processAttachment(
      { fileName: `chart.${extension}`, bytes: await imageFixture(format) },
      signal()
    )
    assert.equal(result.processor, "image:textract+nova+verify")
  }
})

test("audio uses AssemblyAI upload/transcription only and deletes its transcript on success or error", async () => {
  process.env.ASSEMBLYAI_API_KEY = "test-only"
  for (const status of ["completed", "error"]) {
    const requests = []
    globalThis.fetch = async (url, options) => {
      requests.push([url, options.method])
      if (url.endsWith("/upload"))
        return Response.json({ upload_url: "https://cdn.assemblyai.com/test" })
      if (options.method === "POST") {
        assert.deepEqual(JSON.parse(options.body).speech_models, [
          "universal-2",
        ])
        return Response.json({ id: "transcript-id" })
      }
      return Response.json({ status, text: "Audio transcript" })
    }
    const operation = processAttachment(
      { fileName: "clip.mp3", bytes: Buffer.from("ID3audio") },
      signal()
    )
    if (status === "completed")
      assert.equal((await operation).text, "Audio transcript")
    else await assert.rejects(operation)
    assert.equal(requests.at(-1)[1], "DELETE")
    assert.ok(
      requests.every(([url]) =>
        url.startsWith("https://api.assemblyai.com/v2/")
      )
    )
  }
})

test("empty text, malformed bytes, oversized images and aborts never return ready content", async () => {
  await assert.rejects(
    processAttachment(
      { fileName: "empty.txt", bytes: Buffer.from("   ") },
      signal()
    ),
    {
      code: "empty_text",
    }
  )
  for (const name of [
    "fake.png",
    "fake.pdf",
    "fake.docx",
    "fake.wav",
    "fake.ogg",
    "fake.flac",
  ])
    await assert.rejects(validateBytes(name, Buffer.from("invalid")), {
      code: "invalid_file",
    })
  const wide = await sharp({
    create: { width: 8001, height: 1, channels: 3, background: "red" },
  })
    .png()
    .toBuffer()
  await assert.rejects(validateBytes("wide.png", wide), {
    code: "invalid_file",
  })
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(
    processAttachment(
      { fileName: "notes.txt", bytes: Buffer.from("text") },
      aborted.signal
    ),
    { name: "AbortError" }
  )
})
