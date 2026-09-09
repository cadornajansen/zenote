export type ProcessedAttachment = {
  type: "document" | "image" | "audio"
  text?: string
  summary?: string
  metadata?: Record<string, unknown>
  processor: string
}

export type AttachmentProcessor = {
  processAttachment: (file: File) => Promise<ProcessedAttachment>
}

export type AwsAttachmentProcessor = AttachmentProcessor & {
  processor: "amazon-textract" | "amazon-bedrock-nova-vision"
}

// Contract only: never claim a local file has been read or uploaded.
export const processAttachment: AttachmentProcessor["processAttachment"] =
  async () => {
    throw new Error("Attachment processing is not available yet.")
  }
