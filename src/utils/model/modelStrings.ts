import { getModelStrings as getModelStringsState } from 'src/bootstrap/state.js'
import { getInitialSettings } from '../settings/settings.js'
import { ALL_MODEL_CONFIGS, CANONICAL_ID_TO_KEY, type CanonicalModelId, type ModelKey } from './configs.js'

export type ModelStrings = Record<ModelKey, string>

const builtins = Object.fromEntries(
  Object.entries(ALL_MODEL_CONFIGS).map(([key, config]) => [key, config.firstParty]),
) as ModelStrings

export function getModelStrings(): ModelStrings {
  const models = getModelStringsState() ?? builtins
  const overrides = getInitialSettings().modelOverrides
  if (!overrides) return models

  const result = { ...models }
  for (const [canonicalId, override] of Object.entries(overrides)) {
    const key = CANONICAL_ID_TO_KEY[canonicalId as CanonicalModelId]
    if (key && override) result[key] = override
  }
  return result
}

export function resolveOverriddenModel(modelId: string): string {
  try {
    const overrides = getInitialSettings().modelOverrides
    return Object.entries(overrides ?? {}).find(([, override]) => override === modelId)?.[0] ?? modelId
  } catch {
    return modelId
  }
}
