import { describe, expect, test } from 'bun:test'
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
