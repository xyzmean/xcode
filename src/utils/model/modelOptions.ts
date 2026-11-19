import { getMarketingNameForModel, type ModelSetting } from './model.js'
import {
  CHATGPT_SUBSCRIPTION_MODELS,
  OPENAI_API_MODELS,
  getDefaultOpenAIModel,
} from './openaiModels.js'

export type ModelOption = {
  value: ModelSetting
  label: string
  description: string
  descriptionForModel?: string
}

export function getModelOptions(_fastMode = false): ModelOption[] {
  const defaultModel = getDefaultOpenAIModel()
  const defaultLabel = getMarketingNameForModel(defaultModel) ?? defaultModel
  const baseModels = Array.from(
    new Set(
      (process.env.OPENAI_API_KEY
        ? [...OPENAI_API_MODELS, ...CHATGPT_SUBSCRIPTION_MODELS]
        : [...CHATGPT_SUBSCRIPTION_MODELS, ...OPENAI_API_MODELS]
      ).filter(id => !id.endsWith('-fast')),
    ),
  )
  return [
    {
      value: null,
      label: `Default (${defaultLabel})`,
      description: `${defaultModel} · low/medium/high/xhigh effort`,
    },
    ...baseModels.map(id => ({
      value: id,
      label: getMarketingNameForModel(id) ?? id,
      description: `${id} · low/medium/high/xhigh effort`,
    })),
  ]
}
