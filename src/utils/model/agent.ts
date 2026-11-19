import type { PermissionMode } from '../permissions/PermissionMode.js'
import { getRuntimeMainLoopModel, parseUserSpecifiedModel } from './model.js'
import { getDefaultOpenAIFastModel, getDefaultOpenAIModel } from './openaiModels.js'

export function getDefaultSubagentModel(): string {
  return 'inherit'
}

export function getAgentModel(
  agentModel: string | undefined,
  parentModel: string,
  toolSpecifiedModel?: string,
  permissionMode?: PermissionMode,
): string {
  const model = process.env.OPENAI_SUBAGENT_MODEL ?? toolSpecifiedModel ?? agentModel ?? getDefaultSubagentModel()
  if (model !== 'inherit') return parseUserSpecifiedModel(model)
  return getRuntimeMainLoopModel({
    permissionMode: permissionMode ?? 'default',
    mainLoopModel: parentModel,
  })
}

export function getAgentModelDisplay(model: string | undefined): string {
  if (!model) return 'Inherit from parent (default)'
  return model === 'inherit' ? 'Inherit from parent' : model
}

export function getAgentModelOptions() {
  const model = getDefaultOpenAIModel()
  const fastModel = getDefaultOpenAIFastModel()
  return [
    { value: 'inherit', label: 'Inherit from parent', description: 'Use the same model as the main conversation' },
    { value: model, label: model, description: 'Default OpenAI reasoning model' },
    ...(fastModel === model ? [] : [{ value: fastModel, label: fastModel, description: 'Fast OpenAI model' }]),
  ]
}
