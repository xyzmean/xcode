import { AsyncLocalStorage } from 'node:async_hooks'
import type { NonNullableUsage } from '../../entrypoints/sdk/sdkUtilityTypes.js'
import { getTotalCostUSD, setHasUnknownModelCost } from '../../bootstrap/state.js'
import { addToTotalSessionCost } from '../../cost-tracker.js'
import { OPENAI_API_BASE_URL } from '../oauth/openai.js'

type Connection = { method: string; baseURL: string }
type Rate = readonly [input: number, cachedInput: number, output: number]

// Standard USD/Mtok, for <=272K and >272K input respectively.
// https://developers.openai.com/api/docs/pricing
const prices = new Map<string, readonly [Rate, Rate]>([
  ['gpt-6.2-sol', [[2, 0.1, 10], [4, 0.2, 15]]],
  ['gpt-6.2-astra', [[8, 0.4, 40], [16, 0.8, 60]]],
  ['gpt-6.1-sol', [[2, 0.1, 10], [4, 0.2, 15]]],
  ['gpt-6.1-terra', [[1, 0.05, 5], [2, 0.1, 7.5]]],
  ['gpt-6-astra', [[10, 1, 50], [20, 2, 75]]],
  ['gpt-6-luna', [[0.1, 0.01, 0.5], [0.2, 0.02, 0.75]]],
  ['gpt-6-sol', [[2, 0.2, 10], [4, 0.4, 15]]],
  ['gpt-5.6-sol', [[4, 0.4, 20], [8, 0.8, 30]]],
  ['gpt-5.5', [[5, 0.5, 30], [10, 1, 45]]],
])

const budgetScope = new AsyncLocalStorage<{ limit: number; unavailable?: string }>()

export class OpenAIBudgetError extends Error {}

export function withOpenAIBudget<T>(limit: number | undefined, run: () => T): T {
  return limit === undefined ? run() : budgetScope.run({ limit }, run)
}

function ratesFor(connection: Connection, model: string) {
  if (connection.method !== 'api-key' || connection.baseURL !== OPENAI_API_BASE_URL) return
  return prices.get(model)
}

export function checkOpenAIRequestBudget(connection: Connection, model: string): void {
  const budget = budgetScope.getStore()
  if (!budget) return
  if (getTotalCostUSD() >= budget.limit) {
    throw new OpenAIBudgetError(`Reached maximum budget ($${budget.limit})`)
  }
  if (budget.unavailable) throw new OpenAIBudgetError(budget.unavailable)
  if (!ratesFor(connection, model)) {
    throw new OpenAIBudgetError(
      `Cannot enforce --max-budget-usd: no verified API price for ${model} on this connection. Use a priced model on the official API or omit the USD limit.`,
    )
  }
}

export function estimateOpenAIResponseCost(connection: Connection, model: string, usage: NonNullableUsage): number | undefined {
  const rates = ratesFor(connection, model)
  if (!rates) return
  const input = usage.input_tokens
  const cached = usage.cache_read_input_tokens
  const [inputRate, cachedRate, outputRate] = rates[input + cached > 272_000 ? 1 : 0]
  return (input * inputRate + cached * cachedRate + usage.output_tokens * outputRate) / 1_000_000
}

export function accountOpenAIResponse(connection: Connection, model: string, usage: NonNullableUsage | undefined): boolean {
  const budget = budgetScope.getStore()
  const cost = usage && estimateOpenAIResponseCost(connection, model, usage)
  if (cost === undefined) {
    if (connection.method === 'api-key') setHasUnknownModelCost()
    if (budget) budget.unavailable = `Cannot enforce --max-budget-usd: ${model} returned a response without verifiable usage or pricing.`
  }
  if (usage) addToTotalSessionCost(cost ?? 0, usage, model)
  return budget !== undefined && (budget.unavailable !== undefined || getTotalCostUSD() >= budget.limit)
}
