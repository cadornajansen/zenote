export type ModelConfig = {
  id: string
  name: string
  description: string
  provider: "assemblyai"
  providerModelId: string
  fallbackModelId: string
  caching: "automatic" | "explicit"
  // Capabilities enabled through Zenote, not the underlying model's full feature set.
  capabilities: {
    text: boolean
    streaming: boolean
    image: boolean
    files: boolean
    audio: boolean
    tools: boolean
    reasoning: boolean
  }
}

const textCapabilities = {
  text: true,
  streaming: true,
  image: false,
  files: false,
  audio: false,
  tools: false,
  reasoning: false,
}

export const models: readonly ModelConfig[] = (
  [
    {
      id: "gpt-5-nano",
      name: "GPT-5 Nano",
      description: "Quick, lightweight answers",
      providerModelId: "gpt-5-nano",
      fallbackModelId: "gpt-5-mini",
      caching: "automatic",
    },
    {
      id: "gpt-5-mini",
      name: "GPT-5 Mini",
      description: "Everyday writing and coding",
      providerModelId: "gpt-5-mini",
      fallbackModelId: "gpt-5-6-luna",
      caching: "automatic",
    },
    {
      id: "gpt-5-6-luna",
      name: "GPT-5.6 Luna",
      description: "Balanced everyday assistance",
      providerModelId: "gpt-5.6-luna",
      fallbackModelId: "gpt-5-mini",
      caching: "automatic",
    },
    {
      id: "gpt-5-6-terra",
      name: "GPT-5.6 Terra",
      description: "Complex writing and coding",
      providerModelId: "gpt-5.6-terra",
      fallbackModelId: "gpt-5-6-luna",
      caching: "automatic",
    },
    {
      id: "gpt-5-6-sol",
      name: "GPT-5.6 Sol",
      description: "Demanding, detailed tasks",
      providerModelId: "gpt-5.6-sol",
      fallbackModelId: "gpt-5-6-terra",
      caching: "automatic",
    },
    {
      id: "gemini-3-7-flash",
      name: "Gemini 3.7 Flash",
      description: "Fast, versatile assistance",
      providerModelId: "gemini-3.7-flash",
      fallbackModelId: "gpt-5-6-luna",
      caching: "automatic",
    },
    {
      id: "claude-haiku-4-5",
      name: "Claude Haiku 4.5",
      description: "Quick, concise assistance",
      providerModelId: "claude-haiku-4-5-20251001",
      fallbackModelId: "gpt-5-mini",
      caching: "explicit",
    },
    {
      id: "claude-sonnet-5",
      name: "Claude Sonnet 5",
      description: "Thoughtful writing and coding",
      providerModelId: "claude-sonnet-5",
      fallbackModelId: "gpt-5-6-terra",
      caching: "explicit",
    },
    {
      id: "claude-opus-5",
      name: "Claude Opus 5",
      description: "In-depth analysis and complex tasks",
      providerModelId: "claude-opus-5",
      fallbackModelId: "gpt-5-6-sol",
      caching: "explicit",
    },
  ] satisfies Omit<ModelConfig, "provider" | "capabilities">[]
).map((model) => ({
  ...model,
  provider: "assemblyai",
  capabilities: { ...textCapabilities },
}))

export const DEFAULT_MODEL_ID = "gpt-5-mini"

export function getModel(id: string) {
  return models.find((model) => model.id === id)
}

export function getModelByProviderId(id: string) {
  return models.find(
    (model) =>
      id === model.providerModelId ||
      (id.startsWith(`${model.providerModelId}-`) &&
        /^\d{4}-\d{2}-\d{2}$/.test(id.slice(model.providerModelId.length + 1)))
  )
}
