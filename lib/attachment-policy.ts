export const ATTACHMENT_LIMITS = {
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
  // Longer than the Function hard timeout, including cleanup and persistence.
  leaseMs: 360_000,
} as const

export type AttachmentKind = "document" | "image" | "audio"
export type AttachmentStatus = "uploaded" | "processing" | "ready" | "failed"
export type AttachmentSummary = {
  id: string
  name: string
  type: AttachmentKind
  size: string
  status: "attached" | "uploading" | "processing" | "ready" | "error"
  error?: string
  file?: File
  slot?: number
}

export const ATTACHMENT_TYPES: Record<
  string,
  { mime: string; kind: AttachmentKind }
> = {
  txt: { mime: "text/plain", kind: "document" },
  md: { mime: "text/markdown", kind: "document" },
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "document",
  },
  pdf: { mime: "application/pdf", kind: "document" },
  png: { mime: "image/png", kind: "image" },
  jpg: { mime: "image/jpeg", kind: "image" },
  jpeg: { mime: "image/jpeg", kind: "image" },
  webp: { mime: "image/webp", kind: "image" },
  mp3: { mime: "audio/mpeg", kind: "audio" },
  wav: { mime: "audio/wav", kind: "audio" },
  flac: { mime: "audio/flac", kind: "audio" },
  ogg: { mime: "audio/ogg", kind: "audio" },
}
export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_TYPES)
  .map((ext) => `.${ext}`)
  .join(",")

export class AttachmentError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

export function validateAttachmentFile(name: string, size: number) {
  if (
    !name ||
    name.length > 180 ||
    /[\x00-\x1f\x7f/\\\u202a-\u202e\u2066-\u2069]/.test(name) ||
    name === "." ||
    name === ".."
  )
    throw new AttachmentError(
      "invalid_name",
      "Use a filename without paths or control characters."
    )
  const ext = name.split(".").at(-1)?.toLowerCase() ?? ""
  const type = Object.hasOwn(ATTACHMENT_TYPES, ext)
    ? ATTACHMENT_TYPES[ext]
    : undefined
  if (!type)
    throw new AttachmentError(
      "unsupported_type",
      "Supported files: TXT, MD, DOCX, PDF, PNG, JPEG, WebP, MP3, WAV, FLAC, OGG."
    )
  const max =
    type.kind === "image"
      ? ATTACHMENT_LIMITS.imageBytes
      : ["txt", "md"].includes(ext)
        ? ATTACHMENT_LIMITS.textBytes
        : ATTACHMENT_LIMITS.fileBytes
  if (!Number.isSafeInteger(size) || size <= 0)
    throw new AttachmentError("empty_file", "Empty files cannot be attached.")
  if (size > max)
    throw new AttachmentError(
      "file_too_large",
      `This file must be ${max / 1_000_000} MB or smaller.`,
      413
    )
  return { ...type, ext }
}

export function boundedAttachmentText(
  value: string,
  budget = ATTACHMENT_LIMITS.cachedChars as number
) {
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
  if (text.length <= budget) return text
  const marker = "\n[Content truncated: beginning and end retained.]\n"
  if (budget <= marker.length) return marker.slice(0, Math.max(0, budget))
  const available = Math.max(0, budget - marker.length)
  const head = Math.ceil(available * 0.75)
  const tail = available - head
  return text.slice(0, head) + marker + (tail ? text.slice(-tail) : "")
}

export function attachmentSummary(row: {
  $id: string
  fileName: string
  kind: AttachmentKind
  sizeBytes: number
  status: AttachmentStatus
  errorCode?: string | null
}): AttachmentSummary {
  return {
    id: row.$id,
    name: row.fileName,
    type: row.kind,
    size:
      row.sizeBytes >= 1_000_000
        ? `${(row.sizeBytes / 1_000_000).toFixed(1)} MB`
        : `${Math.max(1, Math.round(row.sizeBytes / 1000))} KB`,
    status:
      row.status === "uploaded"
        ? "attached"
        : row.status === "failed"
          ? "error"
          : row.status,
    ...(row.errorCode ? { error: attachmentFailure(row.errorCode) } : {}),
  }
}

export function attachmentFailure(code: string) {
  if (code === "scanned_pdf")
    return "This scanned PDF needs OCR beyond the single-page limit. Attach one page or a text PDF."
  if (code === "empty_text") return "No readable text was found in this file."
  if (code === "interrupted")
    return "Processing stopped. Retry this attachment."
  if (code === "busy")
    return "This attachment is still processing. Try again shortly."
  return "This file could not be processed. Retry or remove it."
}
