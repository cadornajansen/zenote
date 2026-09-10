import { setTimeout as delay } from "node:timers/promises"
import sharp from "sharp"
import mammoth from "mammoth"
import { PDFParse } from "pdf-parse"
import { unzipSync } from "fflate"
import {
  TextractClient,
  DetectDocumentTextCommand,
} from "@aws-sdk/client-textract"
import { processImageAttachment } from "./image-processor.js"
import {
  LIMITS,
  ProcessingError,
  validateFile,
  boundedText,
  isRecord,
} from "./policy.js"
import type {
  AttachmentFileType,
  ProcessingLog,
  ProcessorInput,
  ProcessorResult,
  ProviderEnvironment,
} from "./policy.js"

export async function validateBytes(
  fileName: string,
  bytes: Buffer
): Promise<AttachmentFileType> {
  const type = validateFile(fileName, bytes.length)
  const starts = (signature: string) =>
    bytes.subarray(0, signature.length).toString("latin1") === signature
  let valid = true
  try {
    if (type.kind === "image") {
      const info = await sharp(bytes, {
        limitInputPixels: LIMITS.imageDimension ** 2,
      }).metadata()
      valid =
        info.format === type.mime.split("/")[1] &&
        (info.width ?? 0) > 0 &&
        (info.height ?? 0) > 0 &&
        (info.width ?? 0) <= LIMITS.imageDimension &&
        (info.height ?? 0) <= LIMITS.imageDimension &&
        (info.pages ?? 1) === 1
    } else if (type.ext === "pdf") valid = starts("%PDF-")
    else if (type.ext === "docx") valid = starts("PK\x03\x04")
    else if (type.ext === "wav")
      valid = starts("RIFF") && bytes.subarray(8, 12).toString() === "WAVE"
    else if (type.ext === "flac") valid = starts("fLaC")
    else if (type.ext === "ogg")
      valid =
        starts("OggS") &&
        (bytes.subarray(0, 256).includes(Buffer.from("OpusHead")) ||
          bytes.subarray(0, 256).includes(Buffer.from("vorbis")))
    else if (type.ext === "mp3")
      valid =
        starts("ID3") ||
        (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)
    else
      valid = !new TextDecoder("utf-8", { fatal: true })
        .decode(bytes)
        .includes("\0")
  } catch {
    valid = false
  }
  if (!valid) throw new ProcessingError("invalid_file")
  return type
}

type ExtractedDocument =
  | { format: "docx"; text: string }
  | { format: "pdf"; text: string; pages: number }

export async function extractDocument(
  bytes: Buffer,
  ext: "docx" | "pdf"
): Promise<ExtractedDocument> {
  try {
    if (ext === "docx") {
      let size = 0,
        entries = 0,
        document = false
      unzipSync(bytes, {
        filter(entry) {
          size += entry.originalSize
          entries++
          if (
            size > LIMITS.expandedDocxBytes ||
            entries > 500 ||
            entry.name.includes("..") ||
            /[\\:]|^\//.test(entry.name)
          )
            throw new ProcessingError("invalid_file")
          if (entry.name === "word/document.xml") document = true
          return false
        },
      })
      if (!document) throw new ProcessingError("invalid_file")
      const { value } = await mammoth.extractRawText({ buffer: bytes })
      return { format: "docx", text: value.slice(0, LIMITS.expandedDocxBytes) }
    }
    const parser = new PDFParse({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
    })
    try {
      const { total: pages } = await parser.getInfo()
      const partial =
        pages > LIMITS.pdfPages
          ? [
              ...Array.from({ length: 45 }, (_, i) => i + 1),
              ...Array.from({ length: 5 }, (_, i) => pages - 4 + i),
            ]
          : undefined
      const result = await parser.getText(
        partial ? { partial } : { first: LIMITS.pdfPages }
      )
      const text = result.pages.map((page) => page.text).join("\n\n")
      return {
        format: "pdf",
        text:
          text.trim() && partial
            ? `${text}\n[PDF truncated: first 45 and last 5 pages extracted.]`
            : text,
        pages,
      }
    } finally {
      await parser.destroy()
    }
  } catch {
    throw new ProcessingError("invalid_file")
  }
}

async function transcribe(
  bytes: Buffer,
  signal: AbortSignal,
  apiKey: string | undefined
): Promise<string> {
  const key = apiKey?.trim()
  if (!key) throw new ProcessingError("unavailable")
  let id: string | undefined
  const api = async (
    path: string,
    method: "POST" | "GET" | "DELETE",
    body?: string | Uint8Array<ArrayBuffer>,
    cleanup = false
  ): Promise<Record<string, unknown>> => {
    const response = await fetch(`https://api.assemblyai.com/v2/${path}`, {
      method,
      body,
      signal: cleanup ? AbortSignal.timeout(10_000) : signal,
      redirect: "error",
      headers: {
        authorization: key,
        "content-type":
          path === "upload" ? "application/octet-stream" : "application/json",
      },
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new ProcessingError("processing_failed")
    }
    const result: unknown = await response.json()
    if (!isRecord(result)) throw new ProcessingError("processing_failed")
    return result
  }
  try {
    const uploaded = await api("upload", "POST", new Uint8Array(bytes))
    if (
      typeof uploaded.upload_url !== "string" ||
      !uploaded.upload_url.startsWith("https://")
    )
      throw new ProcessingError("processing_failed")
    const transcript = await api(
      "transcript",
      "POST",
      JSON.stringify({
        audio_url: uploaded.upload_url,
        speech_models: ["universal-2"],
      })
    )
    if (
      typeof transcript.id !== "string" ||
      !/^[a-zA-Z0-9-]+$/.test(transcript.id)
    )
      throw new ProcessingError("processing_failed")
    id = transcript.id
    for (;;) {
      signal.throwIfAborted()
      const result = await api(`transcript/${id}`, "GET")
      if (result.status === "completed")
        return typeof result.text === "string" ? result.text : ""
      if (result.status === "error")
        throw new ProcessingError("processing_failed")
      await delay(1500, undefined, { signal })
    }
  } finally {
    if (id)
      await api(`transcript/${id}`, "DELETE", undefined, true).catch(() => {})
  }
}

export async function processAttachment(
  input: ProcessorInput,
  signal: AbortSignal,
  log: (fields: ProcessingLog) => void = () => {}
): Promise<ProcessorResult> {
  signal.throwIfAborted()
  const type = await validateBytes(input.fileName, input.bytes)
  const env: ProviderEnvironment = {
    ASSEMBLYAI_API_KEY: process.env.ASSEMBLYAI_API_KEY,
    AWS_REGION: process.env.AWS_REGION,
    BEDROCK_NOVA_MODEL_ID: process.env.BEDROCK_NOVA_MODEL_ID,
    BEDROCK_NOVA_VISION_MODEL_ID: process.env.BEDROCK_NOVA_VISION_MODEL_ID,
  }
  let result: ProcessorResult
  if (type.kind === "image") {
    const image = await processImageAttachment(
      input.bytes,
      type,
      env,
      signal,
      log
    )
    result = { kind: "image", ...image }
  } else if (type.kind === "audio") {
    result = {
      kind: "audio",
      processor: "assemblyai",
      text: await transcribe(input.bytes, signal, env.ASSEMBLYAI_API_KEY),
    }
  } else if (type.ext === "txt" || type.ext === "md") {
    result = {
      kind: "document",
      processor: "local-text",
      text: new TextDecoder("utf-8", { fatal: true }).decode(input.bytes),
    }
  } else {
    const document = await extractDocument(input.bytes, type.ext)
    let text = document.text
    let processor: Extract<ProcessorResult, { kind: "document" }>["processor"] =
      type.ext === "docx" ? "mammoth" : "pdf-parse"
    if (document.format === "pdf")
      log({
        event: "attachment.pdf",
        pages: document.pages,
        extractedTextChars: text.length,
        ocrFallback: !text.trim() && document.pages === 1,
      })
    if (document.format === "pdf" && !text.trim()) {
      if (document.pages !== 1) throw new ProcessingError("scanned_pdf")
      signal.throwIfAborted()
      const client = new TextractClient({
        region: env.AWS_REGION,
        maxAttempts: 1,
      })
      try {
        const result = await client.send(
          new DetectDocumentTextCommand({ Document: { Bytes: input.bytes } }),
          { abortSignal: signal }
        )
        text =
          result.Blocks?.filter((block) => block.BlockType === "LINE")
            .map((block) => block.Text ?? "")
            .join("\n") ?? ""
        processor = "textract"
      } finally {
        client.destroy()
      }
    }
    result = { kind: "document", processor, text }
  }
  signal.throwIfAborted()
  const text = boundedText(result.text)
  if (!text) throw new ProcessingError("empty_text")
  return { ...result, text }
}
