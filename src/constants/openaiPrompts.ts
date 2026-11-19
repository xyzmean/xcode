import {
  isOpenAIModel,
  normalizeOpenAIModelName,
} from '../utils/model/openaiModels.js'

export function getOpenAIModelFamilyGuidance(model: string): string | null {
  if (!isOpenAIModel(model)) return null

  const name = normalizeOpenAIModelName(model).toLowerCase()
  if (name.includes('astra')) {
    return `# Model profile: Astra
- On multi-step tasks, give brief one-sentence progress updates between major phases without narrating internal deliberation.`
  }
  if (name.includes('luna')) {
    return `# Model profile: Luna
- Keep investigation focused: read only what you need to make a targeted change and verify it.`
  }
  if (name.includes('terra')) {
    return `# Model profile: Terra
- Balance thorough code inspection with steady execution; check edge cases and inspect test output before reporting completion.`
  }
  return `# Model profile: Sol
- Before editing, reason through architecture, edge cases, and invariants; verify callers, types, and failure modes.`
}
