export const DEFAULT_OPENAI_MODEL = 'gpt-6.2-sol'
export const DEFAULT_OPENAI_FAST_MODEL = 'gpt-6.2-sol-fast'
export const DEFAULT_OPENAI_API_MODEL = 'gpt-6.2-sol'
export const DEFAULT_OPENAI_API_FAST_MODEL = 'gpt-6.2-sol-fast'

export const OPENAI_API_MODELS = [
  'gpt-6.2-sol',
  'gpt-6.2-astra',
  'gpt-6.2',
  'gpt-6.1-sol',
  'gpt-6.1-terra',
  'gpt-6-astra',
  'gpt-6-luna',
  'gpt-6-sol',
  'gpt-5.6-sol',
  'gpt-5.5',
] as const

export const CHATGPT_SUBSCRIPTION_MODELS = [
  'gpt-6.2-sol',
  'gpt-6.2-sol-fast',
  'gpt-6.2-astra',
  'gpt-6.2-astra-fast',
  'gpt-6.1-sol',
  'gpt-6.1-sol-fast',
  'gpt-6.1-terra',
  'gpt-6.1-terra-fast',
  'gpt-6-astra',
  'gpt-6-astra-fast',
  'gpt-6-luna',
  'gpt-6-luna-fast',
  'gpt-6-sol',
  'gpt-6-sol-fast',
  'gpt-5.6-luna',
  'gpt-5.6-luna-fast',
  'gpt-5.6-sol',
  'gpt-5.6-sol-fast',
  'gpt-5.6-terra',
  'gpt-5.6-terra-fast',
  'gpt-5.5',
  'gpt-5.5-fast',
] as const

export function isOpenAIModel(model: string | undefined | null): boolean {
  if (!model || !model.trim()) return false
  const lower = model.trim().toLowerCase()
  if (lower.startsWith('claude-')) return false
  if (process.env.OPENAI_BASE_URL || process.env.OPENAI_API_KEY) {
    return true
  }
  return (
    lower.startsWith('gpt-') ||
    (lower.startsWith('openai/') && Boolean(lower.slice('openai/'.length).trim())) ||
    lower.startsWith('chatgpt-') ||
    lower.startsWith('o1') ||
    lower.startsWith('o3') ||
    lower.startsWith('o4') ||
    lower.startsWith('codex-')
  )
}

export function normalizeOpenAIModelName(model: string): string {
  return model.trim().replace(/^openai\//i, '').trim()
}

export function unsupportedModelMessage(model: string): string {
  return `Unsupported model '${model}'. xCode requires an OpenAI model. Use --model ${DEFAULT_OPENAI_MODEL} or prefix a custom Responses API model with openai/.`
}

export function isOpenAIProviderActive(): boolean {
  return true
}

export function getDefaultOpenAIModel(): string {
  if (process.env.OPENAI_MODEL) return process.env.OPENAI_MODEL
  return process.env.OPENAI_API_KEY
    ? DEFAULT_OPENAI_API_MODEL
    : DEFAULT_OPENAI_MODEL
}

export function getDefaultOpenAIFastModel(): string {
  if (process.env.OPENAI_FAST_MODEL) return process.env.OPENAI_FAST_MODEL
  return process.env.OPENAI_API_KEY
    ? DEFAULT_OPENAI_API_FAST_MODEL
    : DEFAULT_OPENAI_FAST_MODEL
}

export function getOpenAIContextWindow(model: string): number {
  const name = normalizeOpenAIModelName(model).toLowerCase()
  if (name.startsWith('gpt-6')) return 400_000
  if (name.startsWith('gpt-5.6') || name.startsWith('gpt-5.5')) return 400_000
  return 272_000
}

export function getOpenAIMaxOutputTokens(model: string): number {
  const name = normalizeOpenAIModelName(model).toLowerCase()
  if (name.endsWith('-fast')) return 32_768
  return 64_000
}
