import { sideQuery } from '../sideQuery.js'
import { isModelAlias } from './aliases.js'
import { isModelAllowed } from './modelAllowlist.js'
import { CHATGPT_SUBSCRIPTION_MODELS, isOpenAIModel, normalizeOpenAIModelName, unsupportedModelMessage } from './openaiModels.js'

const validModels = new Set<string>(CHATGPT_SUBSCRIPTION_MODELS)

export async function validateModel(model: string): Promise<{ valid: boolean; error?: string }> {
  const name = model.trim()
  if (!name) return { valid: false, error: 'Model name cannot be empty' }

  const alias = isModelAlias(name.toLowerCase())
  if (!alias && !isOpenAIModel(name)) return { valid: false, error: unsupportedModelMessage(name) }
  if (!isModelAllowed(name)) {
    return { valid: false, error: `Model '${name}' is not in the list of available models` }
  }
  if (alias || validModels.has(normalizeOpenAIModelName(name))) return { valid: true }

  try {
    await sideQuery({
      model: name,
      max_tokens: 16,
      maxRetries: 0,
      querySource: 'model_validation',
      messages: [{ role: 'user', content: 'Hi' }],
    })
    validModels.add(normalizeOpenAIModelName(name))
    return { valid: true }
  } catch (error) {
    return { valid: false, error: `Unable to validate model: ${error instanceof Error ? error.message : String(error)}` }
  }
}
