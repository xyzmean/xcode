import { describe, expect, spyOn, test } from 'bun:test'
import { getTotalCostUSD } from '../src/bootstrap/state.js'
import { EMPTY_USAGE } from '../src/services/api/emptyUsage.js'
import { queryOpenAIModel, sideQueryOpenAI } from '../src/services/api/openai.js'
import { checkOpenAIRequestBudget, estimateOpenAIResponseCost, withOpenAIBudget } from '../src/services/api/openAIBudget.js'
import { getEmptyToolPermissionContext } from '../src/Tool.js'
import { createUserMessage } from '../src/utils/messages.js'
import { asSystemPrompt } from '../src/utils/systemPromptType.js'
import {
  clearActiveGoal,
  getActiveGoal,
  getActiveGoalState,
  incrementGoalContinuation,
  MAX_GOAL_LENGTH,
  pauseActiveGoal,
  resumeActiveGoal,
  setActiveGoal,
  setGoalLastReason,
} from '../src/utils/sessionGoal.js'
import { SetGoalTool } from '../src/tools/SetGoalTool/SetGoalTool.js'
import { GetGoalTool } from '../src/tools/GetGoalTool/GetGoalTool.js'
import { PauseGoalTool } from '../src/tools/PauseGoalTool/PauseGoalTool.js'
import { MonitorTool } from '../src/tools/MonitorTool/MonitorTool.js'
import { ListAgentsTool } from '../src/tools/ListAgentsTool/ListAgentsTool.js'
import {
  getOpenAIContextWindow,
  getOpenAIMaxOutputTokens,
  isOpenAIModel,
  normalizeOpenAIModelName,
} from '../src/utils/model/openaiModels.js'

describe('sessionGoal & Goal tools (CC 2.1.327 parity)', () => {
  test('lifecycle: set -> pause -> resume -> reason -> clear', async () => {
    clearActiveGoal()
    expect(getActiveGoal()).toBeNull()
    expect(getActiveGoalState()).toBeUndefined()

    const setRes = await SetGoalTool.call({ condition: 'bun test passes' }, {} as never)
    expect(setRes.data).toEqual({ goal: 'bun test passes', active: true })
    expect(getActiveGoal()).toBe('bun test passes')

    const getRes1 = await GetGoalTool.call({}, {} as never)
    expect(getRes1.data).toEqual({ condition: 'bun test passes' })

    const pauseRes = await PauseGoalTool.call({ reason: 'Need API key' }, {} as never)
    expect(pauseRes.data).toEqual({ condition: 'bun test passes' })
    expect(getActiveGoalState()?.paused).toEqual({ reason: 'Need API key' })

    // While paused, continuation is suppressed
    expect(incrementGoalContinuation()).toBe(false)

    // Resuming on next user turn clears paused state and allows continuation
    expect(resumeActiveGoal()).toBe(true)
    expect(getActiveGoalState()?.paused).toBeUndefined()
    setGoalLastReason('Tests not run yet')
    expect(incrementGoalContinuation()).toBe(true)

    const getRes2 = await GetGoalTool.call({}, {} as never)
    expect(getRes2.data).toEqual({
      condition: 'bun test passes',
      lastReason: 'Tests not run yet',
    })

    expect(clearActiveGoal()).toBe('bun test passes')
    expect(getActiveGoalState()).toBeUndefined()
  })

  test('SetGoal enforces MAX_GOAL_LENGTH = 500', async () => {
    clearActiveGoal()
    const tooLong = 'a'.repeat(MAX_GOAL_LENGTH + 1)
    await expect(
      SetGoalTool.call({ condition: tooLong }, {} as never),
    ).rejects.toThrow(/limited to 500 characters/)
    setActiveGoal('short goal')
    expect(getActiveGoal()).toBe('short goal')
    clearActiveGoal()
  })
})

describe('OpenAI model routing & context windows', () => {
  test('recognizes and normalizes OpenAI models', () => {
    expect(isOpenAIModel('gpt-6-astra')).toBe(true)
    expect(isOpenAIModel('openai/gpt-5.4')).toBe(true)
    expect(normalizeOpenAIModelName('openai/gpt-6.2-sol')).toBe('gpt-6.2-sol')
    expect(getOpenAIContextWindow('gpt-6-astra')).toBe(400_000)
    expect(getOpenAIContextWindow('gpt-5.6-sol')).toBe(400_000)
    expect(getOpenAIMaxOutputTokens('gpt-6.2-sol')).toBe(64_000)
    expect(getOpenAIMaxOutputTokens('gpt-6.2-sol-fast')).toBe(32_768)
  })
})

describe('OpenAI USD budget', () => {
  const official = { method: 'api-key', baseURL: 'https://api.openai.com/v1' }
  const usage = { ...EMPTY_USAGE, input_tokens: 1000, cache_read_input_tokens: 2000, output_tokens: 500 }

  test('prices uncached, cached and output tokens independently and switches long-context rates', () => {
    expect(estimateOpenAIResponseCost(official, 'gpt-6.2-sol', usage)).toBeCloseTo(0.0072, 8)
    expect(estimateOpenAIResponseCost(official, 'gpt-6.2-sol', { ...usage, input_tokens: 271_000 })).toBeCloseTo(1.0919, 8)
    expect(estimateOpenAIResponseCost(official, 'gpt-6.2', usage)).toBeUndefined()
    expect(estimateOpenAIResponseCost({ ...official, baseURL: 'https://custom.invalid/v1' }, 'gpt-6.2-sol', usage)).toBeUndefined()
    expect(estimateOpenAIResponseCost({ ...official, method: 'codex-browser' }, 'gpt-6.2-sol', usage)).toBeUndefined()
  })

  test('settles side requests and prevents a budget-crossing response from yielding a tool call', async () => {
    const prevKey = process.env.OPENAI_API_KEY
    const prevURL = process.env.OPENAI_BASE_URL
    const globals = globalThis as typeof globalThis & { MACRO?: { VERSION: string } }
    const prevMacro = globals.MACRO
    globals.MACRO = { VERSION: 'fixture' }
    process.env.OPENAI_API_KEY = 'local-fixture-only'
    delete process.env.OPENAI_BASE_URL
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const item = { type: 'function_call', id: 'item_budget', call_id: 'call_budget', name: 'Read', arguments: '{}' }
      const events = [
        { type: 'response.output_item.added', item },
        { type: 'response.output_item.done', item },
        { type: 'response.completed', response: { usage: { input_tokens: 3000, output_tokens: 500, input_tokens_details: { cached_tokens: 2000 } } } },
      ]
      return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''))
    })
    try {
      const before = getTotalCostUSD()
      const side = { model: 'gpt-6.2-sol', messages: [{ role: 'user' as const, content: 'Fixture' }] }
      await withOpenAIBudget(before + 0.01, async () => {
        await sideQueryOpenAI(side)
        expect(getTotalCostUSD() - before).toBeCloseTo(0.0072, 8)
        const blocks: string[] = []
        const run = async () => {
          for await (const message of queryOpenAIModel(
            [createUserMessage({ content: 'Fixture' })], asSystemPrompt(['Fixture system']), [], [],
            new AbortController().signal,
            { model: side.model, getToolPermissionContext: async () => getEmptyToolPermissionContext(),
              isNonInteractiveSession: true, querySource: 'sdk', agents: [], hasAppendSystemPrompt: false, mcpTools: [] },
          )) {
            if (message.type === 'assistant') blocks.push(...message.message.content.map(block => block.type))
          }
        }
        await expect(run()).rejects.toThrow('Reached maximum budget')
        expect(blocks).not.toContain('tool_use')
        expect(getTotalCostUSD() - before).toBeCloseTo(0.0144, 8)
        await expect(sideQueryOpenAI(side)).rejects.toThrow('Reached maximum budget')
        expect(fetch).toHaveBeenCalledTimes(2)
      })
      await withOpenAIBudget(before + 1, async () => {
        await expect(sideQueryOpenAI({ ...side, model: 'gpt-6.2' })).rejects.toThrow('no verified API price')
        expect(fetch).toHaveBeenCalledTimes(2)
      })
    } finally {
      fetch.mockRestore()
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = prevKey
      if (prevURL === undefined) delete process.env.OPENAI_BASE_URL
      else process.env.OPENAI_BASE_URL = prevURL
      if (prevMacro === undefined) delete globals.MACRO
      else globals.MACRO = prevMacro
    }
  })

  test('refuses unsupported endpoints only when a USD limit is requested', () => {
    const gateway = { ...official, baseURL: 'https://custom.invalid/v1' }
    expect(() => checkOpenAIRequestBudget(gateway, 'gpt-6.2-sol')).not.toThrow()
    expect(() => withOpenAIBudget(getTotalCostUSD() + 1,
      () => checkOpenAIRequestBudget(gateway, 'gpt-6.2-sol'))).toThrow('no verified API price')
  })
})

describe('MonitorTool & ListAgentsTool parity', () => {
  test('MonitorTool blocks private/loopback WebSocket URLs (SSRF)', async () => {
    await expect(
      MonitorTool.call(
        {
          description: 'loopback ws',
          timeout_ms: 5000,
          persistent: false,
          ws: { url: 'ws://127.0.0.1:8080/ws' },
        },
        {} as never,
      ),
    ).rejects.toThrow(/private, link-local, or cloud-metadata/)
  })

  test('ListAgentsTool formats running and completed agents', async () => {
    const res = await ListAgentsTool.call(
      {},
      {
        getAppState: () => ({
          agentNameRegistry: new Map([['researcher', 'agent-1']]),
          tasks: {
            'agent-1': {
              type: 'local_agent',
              status: 'running',
              startTime: Date.now() - 2000,
              description: 'Inspect repo',
            },
          },
        }),
      } as never,
    )
    expect(res.data.listing).toContain('@researcher (agent-1)')
    expect(res.data.sections?.[0]?.total).toBe(1)
  })
})
