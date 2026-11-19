import { formatTotalCost } from '../../cost-tracker.js'
import { loadOpenAIOAuthTokens } from '../../services/oauth/openai.js'
import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async () => {
  if (!process.env.OPENAI_API_KEY && loadOpenAIOAuthTokens()) {
    return { type: 'text', value: 'USD cost is unavailable for ChatGPT subscription sessions.' }
  }
  return { type: 'text', value: formatTotalCost() }
}
