import { getDefaultOpenAIModel } from '../model/openaiModels.js'

export function getHardcodedTeammateModelFallback(): string {
  return getDefaultOpenAIModel()
}
