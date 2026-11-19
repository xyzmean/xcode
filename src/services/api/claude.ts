import { APIUserAbortError } from 'src/types/llmErrors.js'
import type { ClientOptions } from '@anthropic-ai/sdk'
import type {
  BetaJSONOutputFormat,
  BetaMessageDeltaUsage,
  BetaToolChoiceAuto,
  BetaToolChoiceTool,
  BetaToolUnion,
  BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { QuerySource } from '../../constants/querySource.js'
import type { Notification } from '../../context/notifications.js'
import type { NonNullableUsage } from '../../entrypoints/sdk/sdkUtilityTypes.js'
import {
  getEmptyToolPermissionContext,
  type QueryChainTracking,
  type ToolPermissionContext,
  type Tools,
} from '../../Tool.js'
import type { AgentDefinition } from '../../tools/AgentTool/loadAgentsDir.js'
import type { AgentId } from '../../types/ids.js'
import type { AssistantMessage, Message, StreamEvent, SystemAPIErrorMessage } from '../../types/message.js'
import type { CacheScope } from '../../utils/api.js'
import type { EffortValue } from '../../utils/effort.js'
import { createUserMessage } from '../../utils/messages.js'
import { getDefaultOpenAIFastModel, getOpenAIMaxOutputTokens } from '../../utils/model/openaiModels.js'
import { asSystemPrompt, type SystemPrompt } from '../../utils/systemPromptType.js'
import type { ThinkingConfig } from '../../utils/thinking.js'
import { withStreamingVCR, withVCR } from '../vcr.js'
import { type OpenAIPromptSuggestionRequest, queryOpenAIModel } from './openai.js'

export type Options = {
  getToolPermissionContext: () => Promise<ToolPermissionContext>
  model: string
  toolChoice?: BetaToolChoiceTool | BetaToolChoiceAuto
  isNonInteractiveSession: boolean
  extraToolSchemas?: BetaToolUnion[]
  maxOutputTokensOverride?: number
  fallbackModel?: string
  onStreamingFallback?: () => void
  querySource: QuerySource
  onPromptSuggestionRequest?: (request: OpenAIPromptSuggestionRequest) => void
  agents: AgentDefinition[]
  allowedAgentTypes?: string[]
  hasAppendSystemPrompt: boolean
  fetchOverride?: ClientOptions['fetch']
  enablePromptCaching?: boolean
  skipCacheWrite?: boolean
  temperatureOverride?: number
  effortValue?: EffortValue
  mcpTools: Tools
  hasPendingMcpServers?: boolean
  queryTracking?: QueryChainTracking
  agentId?: AgentId
  outputFormat?: BetaJSONOutputFormat
  fastMode?: boolean
  advisorModel?: string
  addNotification?: (notif: Notification) => void
  taskBudget?: { total: number; remaining?: number }
}

type QueryParams = {
  messages: Message[]
  systemPrompt: SystemPrompt
  thinkingConfig: ThinkingConfig
  tools: Tools
  signal: AbortSignal
  options: Options
}

export async function* queryModelWithStreaming({
  messages, systemPrompt, thinkingConfig, tools, signal, options,
}: QueryParams): AsyncGenerator<StreamEvent | AssistantMessage | SystemAPIErrorMessage, void> {
  yield* withStreamingVCR(messages, () =>
    queryOpenAIModel(messages, systemPrompt, thinkingConfig, tools, signal, options),
  )
}

export async function queryModelWithoutStreaming(params: QueryParams): Promise<AssistantMessage> {
  let assistantMessage: AssistantMessage | undefined
  for await (const message of queryModelWithStreaming(params)) {
    if (message.type === 'assistant') assistantMessage = message
  }
  if (assistantMessage) return assistantMessage
  if (params.signal.aborted) throw new APIUserAbortError()
  throw new Error('No assistant message found')
}

type QueryWithModelParams<T extends { querySource: QuerySource }> = {
  systemPrompt: SystemPrompt
  userPrompt: string
  outputFormat?: BetaJSONOutputFormat
  signal: AbortSignal
  options: T
}
type QueryWithModelOptions = Omit<Options, 'getToolPermissionContext'>

export async function queryWithModel({
  systemPrompt = asSystemPrompt([]), userPrompt, outputFormat, signal, options,
}: QueryWithModelParams<QueryWithModelOptions>): Promise<AssistantMessage> {
  const userMessage = createUserMessage({ content: userPrompt })
  const result = await withVCR(
    [createUserMessage({ content: systemPrompt.map(text => ({ type: 'text', text })) }), userMessage],
    async () => [await queryModelWithoutStreaming({
      messages: [userMessage],
      systemPrompt,
      thinkingConfig: { type: 'disabled' },
      tools: [],
      signal,
      options: {
        ...options,
        outputFormat,
        async getToolPermissionContext() {
          return getEmptyToolPermissionContext()
        },
      },
    })],
  )
  return result[0]! as AssistantMessage
}

export function queryHaiku({
  options, ...params
}: QueryWithModelParams<Omit<QueryWithModelOptions, 'model'>>): Promise<AssistantMessage> {
  return queryWithModel({
    ...params,
    options: { ...options, model: getDefaultOpenAIFastModel() },
  })
}

export function getMaxOutputTokensForModel(model: string): number {
  return getOpenAIMaxOutputTokens(model)
}

export function getCacheControl({ scope }: { scope?: CacheScope; querySource?: QuerySource } = {}) {
  return { type: 'ephemeral' as const, ...(scope === 'global' && { scope }) }
}

export function updateUsage(
  usage: Readonly<NonNullableUsage>,
  partUsage: BetaMessageDeltaUsage | undefined,
): NonNullableUsage {
  if (!partUsage) return { ...usage }
  return {
    ...usage,
    input_tokens: partUsage.input_tokens || usage.input_tokens,
    cache_creation_input_tokens: partUsage.cache_creation_input_tokens || usage.cache_creation_input_tokens,
    cache_read_input_tokens: partUsage.cache_read_input_tokens || usage.cache_read_input_tokens,
    output_tokens: partUsage.output_tokens ?? usage.output_tokens,
    server_tool_use: {
      web_search_requests: partUsage.server_tool_use?.web_search_requests ?? usage.server_tool_use.web_search_requests,
      web_fetch_requests: partUsage.server_tool_use?.web_fetch_requests ?? usage.server_tool_use.web_fetch_requests,
    },
    cache_creation: (partUsage as BetaUsage).cache_creation ?? usage.cache_creation,
    iterations: partUsage.iterations ?? usage.iterations,
    speed: (partUsage as BetaUsage).speed ?? usage.speed,
  }
}

export function accumulateUsage(
  totalUsage: Readonly<NonNullableUsage>,
  messageUsage: Readonly<NonNullableUsage>,
): NonNullableUsage {
  return {
    ...messageUsage,
    input_tokens: totalUsage.input_tokens + messageUsage.input_tokens,
    cache_creation_input_tokens: totalUsage.cache_creation_input_tokens + messageUsage.cache_creation_input_tokens,
    cache_read_input_tokens: totalUsage.cache_read_input_tokens + messageUsage.cache_read_input_tokens,
    output_tokens: totalUsage.output_tokens + messageUsage.output_tokens,
    server_tool_use: {
      web_search_requests: totalUsage.server_tool_use.web_search_requests + messageUsage.server_tool_use.web_search_requests,
      web_fetch_requests: totalUsage.server_tool_use.web_fetch_requests + messageUsage.server_tool_use.web_fetch_requests,
    },
    cache_creation: {
      ephemeral_1h_input_tokens: totalUsage.cache_creation.ephemeral_1h_input_tokens + messageUsage.cache_creation.ephemeral_1h_input_tokens,
      ephemeral_5m_input_tokens: totalUsage.cache_creation.ephemeral_5m_input_tokens + messageUsage.cache_creation.ephemeral_5m_input_tokens,
    },
  }
}
