export type AttachmentKind = "document" | "image" | "audio"
export type AttachmentStatus = "uploaded" | "processing" | "ready" | "failed"
export type ProcessingErrorCode =
  | "invalid_request"
  | "invalid_state"
  | "invalid_file"
  | "lease_lost"
  | "hash_mismatch"
  | "interrupted"
  | "processing_failed"
  | "state_write_failed"
  | "configuration"
  | "unavailable"
  | "scanned_pdf"
  | "empty_text"

export type ProcessorResult =
  | { kind: "document"; processor: "local-text"; text: string }
  | { kind: "document"; processor: "mammoth"; text: string }
  | { kind: "document"; processor: "pdf-parse"; text: string }
  | { kind: "document"; processor: "textract"; text: string }
  | {
      kind: "image"
      processor:
        | "image:textract+nova+verify"
        | "image:textract+nova"
        | "image:textract"
        | "image:nova+verify"
        | "image:nova"
      text: string
    }
  | { kind: "audio"; processor: "assemblyai"; text: string }

export interface ProcessorInput {
  fileName: string
  bytes: Buffer
}

export type ProcessingLog =
  | {
      event: "attachment.pdf"
      pages: number
      extractedTextChars: number
      ocrFallback: boolean
    }
  | { event: "attachment.processing.started" }
  | {
      event: "attachment.processing.ready"
      processor: ProcessorResult["processor"]
    }
  | { event: "attachment.processing.failed"; code: ProcessingErrorCode }
  | {
      event: "attachment.image.stage"
      stage: "textract" | "vision" | "verification"
      success: boolean
      latencyMs: number
      providerRequestId?: string
    }
  | {
      event: "attachment.image.completed"
      latencyMs: number
      degraded: boolean
      status: "ready" | "failed"
      processor?: Extract<ProcessorResult, { kind: "image" }>["processor"]
    }

export interface ProviderEnvironment {
  ASSEMBLYAI_API_KEY?: string
  AWS_REGION?: string
  BEDROCK_NOVA_MODEL_ID?: string
  BEDROCK_NOVA_VISION_MODEL_ID?: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const LIMITS = {
  count: 4,
  fileBytes: 5_000_000,
  imageBytes: 3_500_000,
  textBytes: 1_000_000,
  imageDimension: 8000,
  pdfPages: 50,
  expandedDocxBytes: 20_000_000,
  contextChars: 24_000,
  cachedChars: 24_000,
  processingMs: 120_000,
  leaseMs: 360_000,
}

export const TYPES = {
  txt: ["text/plain", "document"],
  md: ["text/markdown", "document"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "document",
  ],
  pdf: ["application/pdf", "document"],
  png: ["image/png", "image"],
  jpg: ["image/jpeg", "image"],
  jpeg: ["image/jpeg", "image"],
  webp: ["image/webp", "image"],
  mp3: ["audio/mpeg", "audio"],
  wav: ["audio/wav", "audio"],
  flac: ["audio/flac", "audio"],
  ogg: ["audio/ogg", "audio"],
} as const satisfies Record<string, readonly [string, AttachmentKind]>

export type AttachmentExtension = keyof typeof TYPES
export type AttachmentFileType = {
  [Extension in AttachmentExtension]: {
    ext: Extension
    mime: (typeof TYPES)[Extension][0]
    kind: (typeof TYPES)[Extension][1]
  }
}[AttachmentExtension]

export class ProcessingError extends Error {
  readonly code: ProcessingErrorCode

  constructor(code: ProcessingErrorCode) {
    super(code)
    this.code = code
  }
}

export function validateFile(name: unknown, size: unknown): AttachmentFileType {
  if (
    typeof name !== "string" ||
    !name ||
    name.length > 180 ||
    /[\x00-\x1f\x7f/\\\u202a-\u202e\u2066-\u2069]/.test(name)
  )
    throw new ProcessingError("invalid_file")
  const ext = name.split(".").at(-1)!.toLowerCase()
  if (!Object.hasOwn(TYPES, ext)) throw new ProcessingError("invalid_file")
  const extension = ext as AttachmentExtension
  const [mime, kind] = TYPES[extension]
  const max =
    kind === "image"
      ? LIMITS.imageBytes
      : ["txt", "md"].includes(ext)
        ? LIMITS.textBytes
        : LIMITS.fileBytes
  if (
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > max
  )
    throw new ProcessingError("invalid_file")
  return { ext: extension, mime, kind } as AttachmentFileType
}

export function boundedText(
  value: string,
  budget = LIMITS.cachedChars
): string {
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
  if (text.length <= budget) return text
  const marker = "\n[Content truncated: beginning and end retained.]\n"
  if (budget <= marker.length) return marker.slice(0, Math.max(0, budget))
  const available = budget - marker.length
  const head = Math.ceil(available * 0.75)
  const tail = available - head
  return text.slice(0, head) + marker + (tail ? text.slice(-tail) : "")
}
