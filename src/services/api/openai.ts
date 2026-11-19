import { randomUUID } from 'node:crypto'
import zlib from 'node:zlib'
import { APIUserAbortError } from 'src/types/llmErrors.js'
import type {
  BetaContentBlock,
  BetaMessage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { getSessionId } from '../../bootstrap/state.js'
import { renderOpenAISystemPrompt } from '../../constants/openaiPrompts.js'
import { addToTotalSessionCost } from '../../cost-tracker.js'
import type { Tools } from '../../Tool.js'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
} from '../../types/message.js'
import { toolToAPISchema } from '../../utils/api.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  createAssistantAPIErrorMessage,
  ensureToolResultPairing,
  normalizeMessagesForAPI,
} from '../../utils/messages.js'
import { CHATGPT_SUBSCRIPTION_MODELS, isOpenAIModel, normalizeOpenAIModelName, unsupportedModelMessage } from '../../utils/model/openaiModels.js'
import type { SystemPrompt } from '../../utils/systemPromptType.js'
import type { ThinkingConfig } from '../../utils/thinking.js'
import {
  getValidOpenAICredentials,
  loadOpenAIOAuthTokens,
  refreshOpenAIOAuthTokens,
} from '../oauth/openai.js'
import type { Options } from './claude.js'
import { PROMPT_TOO_LONG_ERROR_MESSAGE } from './errors.js'
import { EMPTY_USAGE } from './emptyUsage.js'

const OPENAI_REASONING_SIG_PREFIX = 'openai_rs_v1:'

type OpenAIInputItem = Record<string, unknown>

export type OpenAIPromptSuggestionRequest = (
  prompt: string,
  signal: AbortSignal,
) => Promise<{ suggestion: string | null; generationRequestId: string | null }>

type OpenAITool = {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
  strict: false
}

// OpenAI reports context overflow differently from Anthropic. Translate into
// the canonical "prompt is too long: N tokens > M maximum" form so
// isPromptTooLongMessage / reactive compaction handle it uniformly.
export function normalizeOpenAIContextOverflow(errText: string): string | null {
  // Chat Completions style: "maximum context length is 128000 tokens. However,
  // your messages resulted in 130000 tokens."
  const cc = errText.match(/maximum context length is (\d+) tokens[\s\S]*?(\d+) tokens/i)
  if (cc) {
    return `prompt is too long: ${cc[2]} tokens > ${cc[1]} maximum`
  }
  // Responses style: "Your input exceeds the context window of this model" /
  // code "context_length_exceeded", sometimes with token counts.
  if (/context_length_exceeded|exceeds the context window|input length.*exceed.*context/i.test(errText)) {
    const counts = errText.match(/(\d+)\s*tokens?[^0-9]*?(\d+)/i)
    if (counts) {
      const a = parseInt(counts[1]!, 10)
      const b = parseInt(counts[2]!, 10)
      return `prompt is too long: ${Math.max(a, b)} tokens > ${Math.min(a, b)} maximum`
    }
    return 'prompt is too long'
  }
  return null
}

function serializeToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return JSON.stringify(content ?? '')
  const parts: string[] = []
  for (const item of content) {
    if (typeof item === 'string') {
      parts.push(item)
    } else if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>
      if (rec.type === 'text' && typeof rec.text === 'string') {
        parts.push(rec.text)
      } else {
        parts.push(JSON.stringify(rec))
      }
    }
  }
  return parts.join('\n')
}

function cleanJsonSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'object', properties: {} }
  }
  const obj = { ...(schema as Record<string, unknown>) }
  delete obj.$schema
  delete obj.$id
  delete obj.cache_control
  if (obj.properties && typeof obj.properties === 'object' && !Array.isArray(obj.properties)) {
    const props: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj.properties as Record<string, unknown>)) {
      props[k] = v && typeof v === 'object' && !Array.isArray(v) ? cleanJsonSchema(v) : v
    }
    obj.properties = props
  }
  if (obj.items && typeof obj.items === 'object' && !Array.isArray(obj.items)) {
    obj.items = cleanJsonSchema(obj.items)
  }
  return obj
}

function convertMessagesToOpenAIInput(messages: Message[]): OpenAIInputItem[] {
  const items: OpenAIInputItem[] = []

  for (const rawMsg of messages) {
    const msg = rawMsg as unknown as { type: string; message?: { content?: unknown } }
    if (msg.type === 'user') {
      const rawContent = msg.message?.content
      if (typeof rawContent === 'string') {
        items.push({
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: rawContent }],
        })
        continue
      }
      if (!Array.isArray(rawContent)) continue

      const userParts: Array<Record<string, unknown>> = []
      const flushUserParts = () => {
        if (userParts.length > 0) {
          items.push({
            type: 'message',
            role: 'user',
            content: [...userParts],
          })
          userParts.length = 0
        }
      }

      for (const block of rawContent) {
        if (!block || typeof block !== 'object') continue
        const b = block as Record<string, unknown>
        if (b.type === 'text' && typeof b.text === 'string') {
          userParts.push({ type: 'input_text', text: b.text })
        } else if (b.type === 'image' && b.source && typeof b.source === 'object') {
          const src = b.source as Record<string, unknown>
          if (src.type === 'base64' && typeof src.data === 'string' && typeof src.media_type === 'string') {
            userParts.push({
              type: 'input_image',
              image_url: `data:${src.media_type};base64,${src.data}`,
            })
          } else if (src.type === 'url' && typeof src.url === 'string') {
            userParts.push({
              type: 'input_image',
              image_url: src.url,
            })
          }
        } else if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
          flushUserParts()
          const text = serializeToolResultContent(b.content)
          items.push({
            type: 'function_call_output',
            call_id: b.tool_use_id,
            output: b.is_error === true ? `[Tool Error]\n${text}` : text,
          })
        }
      }
      flushUserParts()
      continue
    }

    if (msg.type === 'assistant') {
      const content = msg.message?.content
      if (!Array.isArray(content)) continue

      for (const block of content) {
        if (!block || typeof block !== 'object') continue
        const b = block as Record<string, unknown>
        if (b.type === 'thinking') {
          const sig = typeof b.signature === 'string' ? b.signature : ''
          if (sig.startsWith(OPENAI_REASONING_SIG_PREFIX)) {
            try {
              const meta = JSON.parse(sig.slice(OPENAI_REASONING_SIG_PREFIX.length)) as {
                id?: string
                encrypted_content?: string
              }
              if (meta.encrypted_content) {
                items.push({
                  type: 'reasoning',
                  ...(meta.id ? { id: meta.id } : {}),
                  encrypted_content: meta.encrypted_content,
                  summary:
                    typeof b.thinking === 'string' && b.thinking
                      ? [{ type: 'summary_text', text: b.thinking }]
                      : [],
                })
              }
            } catch {
              // Ignore malformed reasoning signature
            }
          }
        } else if (b.type === 'text' && typeof b.text === 'string' && b.text.length > 0) {
          items.push({
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: b.text }],
          })
        } else if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
          items.push({
            type: 'function_call',
            call_id: b.id,
            name: b.name,
            arguments: JSON.stringify(b.input ?? {}),
          })
        }
      }
    }
  }

  return items
}

function buildInstructions(
  systemPrompt: SystemPrompt,
  tools: Tools,
  options: Options,
): string {
  const qs = String(options.querySource)
  const isAgenticQuery =
    qs.startsWith('repl_main_thread') ||
    qs.startsWith('agent:') ||
    qs === 'sdk' ||
    qs === 'hook_agent' ||
    qs === 'verification_agent'

  if (!isAgenticQuery) {
    return systemPrompt.filter(Boolean).join('\n\n')
  }

  const basePrompt = renderOpenAISystemPrompt(tools.map(t => t.name), options.model)
  // Keep dynamic context sections (git status, CLAUDE.md, appendSystemPrompt) if present after the base prompt
  const extraSections = systemPrompt.slice(1).filter(Boolean)
  return extraSections.length > 0
    ? `${basePrompt}\n\n${extraSections.join('\n\n')}`
    : basePrompt
}

function mapReasoningEffort(
  model: string,
  thinkingConfig: ThinkingConfig,
  options: Options,
): { effort: string; summary: 'auto' } | undefined {
  if (thinkingConfig.type === 'disabled') return undefined
  if (model.toLowerCase().endsWith('-fast')) return { effort: 'low', summary: 'auto' }
  const effort = String(options.effortValue ?? '')
  if (effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh') {
    return { effort, summary: 'auto' }
  }
  if (effort === 'max') {
    return { effort: 'xhigh', summary: 'auto' }
  }
  return { effort: 'medium', summary: 'auto' }
}

async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      if (signal.aborted) break
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let boundary: RegExpExecArray | null
      while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
        const chunk = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary[0].length)

        let eventName = 'message'
        const dataLines: string[] = []
        for (const rawLine of chunk.split('\n')) {
          const line = rawLine.replace(/\r$/, '')
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim()
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart())
          }
        }
        if (dataLines.length === 0) continue
        const rawData = dataLines.join('\n')
        if (rawData === '[DONE]') return
        try {
          const data = JSON.parse(rawData)
          const event = eventName === 'message' && typeof data?.type === 'string' ? data.type : eventName
          yield { event, data }
        } catch {
          // Ignore non-JSON keepalives
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export async function* queryOpenAIModel(
  messages: Message[],
  systemPrompt: SystemPrompt,
  thinkingConfig: ThinkingConfig,
  tools: Tools,
  signal: AbortSignal,
  options: Options,
): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
> {
  if (!isOpenAIModel(options.model)) {
    yield createAssistantAPIErrorMessage({
      content: unsupportedModelMessage(options.model),
      apiError: 'unknown',
      error: 'unknown',
    })
    return
  }

  const baseModel = normalizeOpenAIModelName(options.model)
  const fastCandidate = `${baseModel}-fast`
  const model =
    options.fastMode &&
    !baseModel.endsWith('-fast') &&
    (CHATGPT_SUBSCRIPTION_MODELS as readonly string[]).includes(fastCandidate)
      ? fastCandidate
      : baseModel
  let creds: Awaited<ReturnType<typeof getValidOpenAICredentials>>
  try {
    creds = await getValidOpenAICredentials()
  } catch (err) {
    yield createAssistantAPIErrorMessage({
      content: `OpenAI authentication error: ${err instanceof Error ? err.message : String(err)}`,
      apiError: 'authentication_failed',
      error: 'authentication_failed',
    })
    return
  }

  const openAITools: OpenAITool[] = []
  for (const tool of tools) {
    const schema = (await toolToAPISchema(tool, {
      getToolPermissionContext: options.getToolPermissionContext,
      tools,
      agents: options.agents,
      allowedAgentTypes: options.allowedAgentTypes,
      model,
    })) as unknown as { name: string; description?: string; input_schema?: unknown }
    openAITools.push({
      type: 'function',
      name: schema.name,
      description: schema.description ?? '',
      parameters: cleanJsonSchema(schema.input_schema),
      strict: false,
    })
  }
  if (options.extraToolSchemas) {
    for (const rawExtra of options.extraToolSchemas) {
      const extra = rawExtra as unknown as { name?: string; description?: string; input_schema?: unknown }
      if (extra.input_schema && extra.name) {
        openAITools.push({
          type: 'function',
          name: extra.name,
          description: extra.description ?? '',
          parameters: cleanJsonSchema(extra.input_schema),
          strict: false,
        })
      }
    }
  }

  const instructions = buildInstructions(systemPrompt, tools, options)
  const input = convertMessagesToOpenAIInput(
    ensureToolResultPairing(normalizeMessagesForAPI(messages, tools)),
  )
  const reasoning = mapReasoningEffort(model, thinkingConfig, options)

  const bodyObj: Record<string, unknown> = {
    model,
    instructions,
    input,
    prompt_cache_key: getSessionId(),
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content'],
    ...(openAITools.length > 0
      ? {
          tools: openAITools,
          parallel_tool_calls: !options.toolChoice || options.toolChoice.type === 'auto',
        }
      : {}),
    ...(options.toolChoice
      ? {
          tool_choice:
            options.toolChoice.type === 'tool'
              ? { type: 'function', name: options.toolChoice.name }
              : (options.toolChoice.type as string) === 'any'
                ? 'required'
                : 'auto',
        }
      : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(options.temperatureOverride !== undefined ? { temperature: options.temperatureOverride } : {}),
    ...(options.outputFormat
      ? {
          text: {
            format: {
              type: 'json_schema',
              name: 'structured_output',
              schema: cleanJsonSchema(options.outputFormat.schema),
              strict: false,
            },
          },
        }
      : {}),
  }

  // Note: ChatGPT / Codex subscription endpoints reject max_output_tokens; only send for direct API keys
  if (creds.method === 'api-key' && options.maxOutputTokensOverride) {
    bodyObj.max_output_tokens = options.maxOutputTokensOverride
  }

  const capture = options.onPromptSuggestionRequest
  yield* streamOpenAIResponse(bodyObj, creds, signal, options.model, undefined,
    capture && (messages => {
      const continuation = convertMessagesToOpenAIInput(messages)
      capture((prompt, signal) => requestOpenAIPromptSuggestion({
        ...bodyObj,
        input: [...input, ...continuation, {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: prompt }],
        }],
      }, creds, signal, options.model))
    }),
  )
}

async function requestOpenAIPromptSuggestion(
  body: Record<string, unknown>,
  creds: Awaited<ReturnType<typeof getValidOpenAICredentials>>,
  signal: AbortSignal,
  accountingModel: string,
): ReturnType<OpenAIPromptSuggestionRequest> {
  let text = ''
  let generationRequestId: string | null = null
  let completed = false
  let hasToolCalls = false
  // Keep tool schemas for the cache prefix, but never dispatch the generated calls.
  for await (const message of streamOpenAIResponse(body, creds, signal, accountingModel, 0)) {
    if (message.type === 'assistant') {
      if (message.isApiErrorMessage) return { suggestion: null, generationRequestId: null }
      for (const block of message.message.content) {
        if (block.type === 'tool_use') hasToolCalls = true
        if (block.type === 'text') text += block.text
      }
      generationRequestId = message.requestId ?? null
    } else if (message.type === 'stream_event' && message.event.type === 'message_stop') {
      completed = true
    }
  }
  const suggestion = text.trim()
  return {
    suggestion: completed && !signal.aborted && !hasToolCalls && suggestion &&
      !/[\x00-\x1f\x7f-\x9f]/.test(suggestion) ? suggestion : null,
    generationRequestId,
  }
}

function extractOpenAIUsage(u: Record<string, unknown> | undefined): {
  input_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  output_tokens: number
  [key: string]: unknown
} {
  if (!u) {
    return { ...(EMPTY_USAGE as Record<string, unknown>) } as {
      input_tokens: number
      cache_creation_input_tokens: number
      cache_read_input_tokens: number
      output_tokens: number
      [key: string]: unknown
    }
  }
  const inputDetails = (u.input_tokens_details ?? u.prompt_tokens_details) as
    | Record<string, unknown>
    | undefined
  const cached =
    typeof inputDetails?.cached_tokens === 'number' ? inputDetails.cached_tokens : 0
  const totalIn =
    typeof u.input_tokens === 'number'
      ? u.input_tokens
      : typeof u.prompt_tokens === 'number'
        ? u.prompt_tokens
        : 0
  const totalOut =
    typeof u.output_tokens === 'number'
      ? u.output_tokens
      : typeof u.completion_tokens === 'number'
        ? u.completion_tokens
        : 0
  return {
    ...(EMPTY_USAGE as Record<string, unknown>),
    input_tokens: Math.max(0, totalIn - cached),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cached,
    output_tokens: totalOut,
  }
}

async function* streamOpenAIResponse(
  bodyObj: Record<string, unknown>,
  creds: Awaited<ReturnType<typeof getValidOpenAICredentials>>,
  signal: AbortSignal,
  accountingModel: string,
  maxRetries?: number,
  onCompleted?: (messages: AssistantMessage[]) => void,
): AsyncGenerator<StreamEvent | AssistantMessage | SystemAPIErrorMessage, void> {
  const model = bodyObj.model as string
  const requestId = randomUUID()
  const sessionId = getSessionId()
  const jsonBody = JSON.stringify(bodyObj)
  const useZstd = creds.method !== 'api-key' && !creds.isCustomBaseURL
  const payload = useZstd ? zlib.zstdCompressSync(Buffer.from(jsonBody)) : jsonBody

  const buildHeaders = (token: string, accountID?: string): Record<string, string> => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'User-Agent': `xCode/${MACRO.VERSION}`,
    originator: 'opencode',
    'session-id': sessionId,
    'thread-id': sessionId,
    'x-client-request-id': requestId,
    ...(accountID ? { 'chatgpt-account-id': accountID } : {}),
    ...(useZstd ? { 'Content-Encoding': 'zstd' } : {}),
  })

  const startTime = Date.now()
  let response: Response
  try {
    response = await fetchOpenAIWithRetry({
      url: `${creds.baseURL}/responses`,
      payload,
      creds,
      buildHeaders,
      signal,
      maxRetries,
    })
  } catch (err) {
    if (signal.aborted) {
      throw new APIUserAbortError()
    }
    yield createAssistantAPIErrorMessage({
      content: `OpenAI network error: ${err instanceof Error ? err.message : String(err)}`,
      apiError: 'unknown',
      error: 'unknown',
    })
    return
  }

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => '')
    logForDebugging(`[OpenAI API Error] ${response.status}: ${errText.slice(0, 500)}`, { level: 'error' })
    const overflow = response.status === 400 || response.status === 413
      ? normalizeOpenAIContextOverflow(errText)
      : null
    if (overflow) {
      yield createAssistantAPIErrorMessage({
        content: PROMPT_TOO_LONG_ERROR_MESSAGE,
        apiError: 'invalid_request',
        error: 'invalid_request',
        errorDetails: overflow,
      })
      return
    }
    yield createAssistantAPIErrorMessage({
      content: `OpenAI API error (${response.status}): ${errText.slice(0, 500)}`,
      apiError: response.status === 401 ? 'authentication_failed' : response.status === 429 ? 'rate_limit' : 'unknown',
      error: response.status === 401 ? 'authentication_failed' : response.status === 429 ? 'rate_limit' : 'unknown',
    })
    return
  }

  let responseId = `resp_${requestId}`
  let nextBlockIndex = 0
  let hasToolCalls = false
  let completed = false
  let ttftMs: number | undefined
  let finalUsage: {
    input_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
    output_tokens: number
    [key: string]: unknown
  } = { ...(EMPTY_USAGE as Record<string, unknown>) } as {
    input_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
    output_tokens: number
    [key: string]: unknown
  }
  const yieldedMessages: AssistantMessage[] = []

  type ActiveItem =
    | { kind: 'thinking'; index: number; itemId: string; text: string }
    | { kind: 'text'; index: number; itemId: string; text: string }
    | { kind: 'tool_use'; index: number; itemId: string; callId: string; name: string; args: string }

  const activeItems = new Map<string, ActiveItem>()

  yield {
    type: 'stream_event',
    event: {
      type: 'message_start',
      message: {
        id: responseId,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { ...EMPTY_USAGE },
      },
    },
  }

  for await (const { event, data } of parseSSE(response.body, signal)) {
    const payloadData = (data ?? {}) as Record<string, unknown>

    if (event === 'response.created') {
      const resp = payloadData.response as Record<string, unknown> | undefined
      if (resp && typeof resp.id === 'string') {
        responseId = resp.id
      }
      continue
    }

    if (event === 'response.output_item.added') {
      const item = payloadData.item as Record<string, unknown> | undefined
      if (!item || typeof item.id !== 'string') continue
      if (ttftMs === undefined) ttftMs = Date.now() - startTime

      const idx = nextBlockIndex++
      if (item.type === 'reasoning') {
        activeItems.set(item.id, { kind: 'thinking', index: idx, itemId: item.id, text: '' })
        yield {
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            index: idx,
            content_block: { type: 'thinking', thinking: '', signature: '' },
          },
          ...(idx === 0 ? { ttftMs } : undefined),
        }
      } else if (item.type === 'message') {
        activeItems.set(item.id, { kind: 'text', index: idx, itemId: item.id, text: '' })
        yield {
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            index: idx,
            content_block: { type: 'text', text: '' },
          },
          ...(idx === 0 ? { ttftMs } : undefined),
        }
      } else if (item.type === 'function_call') {
        hasToolCalls = true
        const callId = typeof item.call_id === 'string' ? item.call_id : item.id
        const name = typeof item.name === 'string' ? item.name : 'unknown'
        activeItems.set(item.id, {
          kind: 'tool_use',
          index: idx,
          itemId: item.id,
          callId,
          name,
          args: '',
        })
        yield {
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            index: idx,
            content_block: { type: 'tool_use', id: callId, name, input: {} },
          },
          ...(idx === 0 ? { ttftMs } : undefined),
        }
      }
      continue
    }

    if (
      event === 'response.reasoning_summary_text.delta' ||
      event === 'response.reasoning_text.delta'
    ) {
      const itemId = payloadData.item_id as string | undefined
      const delta = payloadData.delta as string | undefined
      const active = itemId ? activeItems.get(itemId) : undefined
      if (active && active.kind === 'thinking' && typeof delta === 'string') {
        active.text += delta
        yield {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            index: active.index,
            delta: { type: 'thinking_delta', thinking: delta },
          },
        }
      }
      continue
    }

    if (event === 'response.output_text.delta') {
      const itemId = payloadData.item_id as string | undefined
      const delta = payloadData.delta as string | undefined
      const active = itemId ? activeItems.get(itemId) : undefined
      if (active && active.kind === 'text' && typeof delta === 'string') {
        active.text += delta
        yield {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            index: active.index,
            delta: { type: 'text_delta', text: delta },
          },
        }
      }
      continue
    }

    if (event === 'response.function_call_arguments.delta') {
      const itemId = payloadData.item_id as string | undefined
      const delta = payloadData.delta as string | undefined
      const active = itemId ? activeItems.get(itemId) : undefined
      if (active && active.kind === 'tool_use' && typeof delta === 'string') {
        active.args += delta
        yield {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            index: active.index,
            delta: { type: 'input_json_delta', partial_json: delta },
          },
        }
      }
      continue
    }

    if (event === 'response.function_call_arguments.done') {
      const itemId = payloadData.item_id as string | undefined
      const active = itemId ? activeItems.get(itemId) : undefined
      if (active?.kind === 'tool_use' && typeof payloadData.arguments === 'string') {
        active.args = payloadData.arguments
      }
      continue
    }

    if (event === 'response.output_item.done') {
      const item = payloadData.item as Record<string, unknown> | undefined
      if (!item || typeof item.id !== 'string') continue
      const active = activeItems.get(item.id)
      if (!active) continue

      let block: BetaContentBlock | undefined
      if (active.kind === 'thinking') {
        const encrypted = typeof item.encrypted_content === 'string' ? item.encrypted_content : undefined
        const sig = encrypted
          ? `${OPENAI_REASONING_SIG_PREFIX}${JSON.stringify({ id: item.id, encrypted_content: encrypted })}`
          : ''
        block = {
          type: 'thinking',
          thinking: active.text,
          signature: sig,
        }
      } else if (active.kind === 'text') {
        let finalText = active.text
        if (!finalText && Array.isArray(item.content)) {
          finalText = (item.content as Array<Record<string, unknown>>)
            .filter(c => c.type === 'output_text' && typeof c.text === 'string')
            .map(c => c.text as string)
            .join('')
        }
        block = {
          type: 'text',
          text: finalText,
          citations: [],
        }
      } else if (active.kind === 'tool_use') {
        const rawArgs = typeof item.arguments === 'string' ? item.arguments : active.args
        let parsedInput: Record<string, unknown> = {}
        try {
          parsedInput = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {}
        } catch {
          parsedInput = { raw: rawArgs }
        }
        block = {
          type: 'tool_use',
          id: active.callId,
          name: active.name,
          input: parsedInput,
        }
      }

      if (block) {
        const msg: AssistantMessage = {
          message: {
            id: responseId,
            container: null,
            model,
            role: 'assistant',
            stop_reason: null,
            stop_sequence: null,
            type: 'message',
            usage: finalUsage,
            content: [block],
          },
          requestId,
          type: 'assistant',
          uuid: randomUUID(),
          timestamp: new Date().toISOString(),
        }
        yieldedMessages.push(msg)
      }

      yield {
        type: 'stream_event',
        event: {
          type: 'content_block_stop',
          index: active.index,
        },
      }
      activeItems.delete(item.id)
      continue
    }

    if (event === 'response.completed' || event === 'response.done') {
      completed = true
      const resp = payloadData.response as Record<string, unknown> | undefined
      const u = (resp?.usage ?? payloadData.usage) as Record<string, unknown> | undefined
      if (u) {
        finalUsage = extractOpenAIUsage(u)
      }
      const stopReason: 'tool_use' | 'end_turn' = hasToolCalls ? 'tool_use' : 'end_turn'
      for (const m of yieldedMessages) {
        const mutable = m as unknown as { message: { usage: unknown; stop_reason: unknown } }
        mutable.message.usage = finalUsage
        mutable.message.stop_reason = stopReason
        yield m
      }
      addToTotalSessionCost(0, finalUsage as never, accountingModel)
      if (!hasToolCalls) onCompleted?.(yieldedMessages)
      yield {
        type: 'stream_event',
        event: {
          type: 'message_delta',
          delta: { stop_reason: stopReason, stop_sequence: null },
          usage: {
            input_tokens: finalUsage.input_tokens,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: finalUsage.cache_read_input_tokens,
            output_tokens: finalUsage.output_tokens,
            server_tool_use: null,
          },
        },
      }
      yield {
        type: 'stream_event',
        event: { type: 'message_stop' },
      }
      continue
    }

    if (event === 'response.incomplete') {
      const resp = payloadData.response as Record<string, unknown> | undefined
      const details = resp?.incomplete_details as Record<string, unknown> | undefined
      const reason = typeof details?.reason === 'string' ? details.reason : 'unknown'
      yield createAssistantAPIErrorMessage({
        content: `OpenAI response incomplete (${reason}). The model stopped before finishing; try again or reduce the request size.`,
        apiError: 'unknown',
        error: 'unknown',
      })
      return
    }

    if (event === 'response.failed' || event === 'error') {
      const errObj = (payloadData.error ?? (payloadData.response as Record<string, unknown> | undefined)?.error) as
        | Record<string, unknown>
        | undefined
      const msg = typeof errObj?.message === 'string' ? errObj.message : JSON.stringify(payloadData)
      const overflow = normalizeOpenAIContextOverflow(msg)
      if (overflow) {
        yield createAssistantAPIErrorMessage({
          content: PROMPT_TOO_LONG_ERROR_MESSAGE,
          apiError: 'invalid_request',
          error: 'invalid_request',
          errorDetails: overflow,
        })
        return
      }
      yield createAssistantAPIErrorMessage({
        content: `OpenAI stream error: ${msg}`,
        apiError: 'unknown',
        error: 'unknown',
      })
      return
    }
  }

  // Stream ended without response.completed — surface the failure instead of
  // silently returning a truncated turn with no usage accounting.
  if (!completed && !signal.aborted) {
    yield createAssistantAPIErrorMessage({
      content: 'OpenAI stream ended unexpectedly before completion. Please retry.',
      apiError: 'unknown',
      error: 'unknown',
    })
  }
}

async function fetchOpenAIWithRetry({
  url,
  payload,
  creds,
  buildHeaders,
  signal,
  maxRetries = 3,
}: {
  url: string
  payload: string | Uint8Array
  creds: Awaited<ReturnType<typeof getValidOpenAICredentials>>
  buildHeaders: (token: string, accountID?: string) => Record<string, string>
  signal?: AbortSignal
  maxRetries?: number
}): Promise<Response> {
  let token = creds.token
  let accountID = creds.accountID
  let refreshedOn401 = false

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(token, accountID),
      body: payload as BodyInit,
      signal,
    })

    if (res.status === 401 && !refreshedOn401 && creds.method !== 'api-key') {
      const stored = loadOpenAIOAuthTokens()
      if (stored) {
        refreshedOn401 = true
        logForDebugging('[OpenAI API] Got 401, refreshing OAuth token and retrying')
        const updated = await refreshOpenAIOAuthTokens(stored)
        token = updated.accessToken
        accountID = updated.accountID ?? accountID
        continue
      }
    }

    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const retryAfter = Number(res.headers.get('retry-after'))
      let delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 10_000)
        : Math.min(1000 * 2 ** attempt, 8000)
      // Gateway queue exhaustion: providers free up on the order of tens of
      // seconds, so back off longer than for ordinary rate limits.
      if (res.status === 503 || res.status === 429) {
        const errText = await res.text().catch(() => '')
        if (errText.includes('queue_exhausted')) {
          delayMs = Math.max(delayMs, Math.min(5000 * (attempt + 1), 20_000))
        }
      }
      logForDebugging(`[OpenAI API] ${res.status}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`)
      await new Promise(resolve => setTimeout(resolve, delayMs))
      if (signal?.aborted) throw new APIUserAbortError()
      continue
    }

    return res
  }

  throw new Error('OpenAI request exhausted retries')
}

export async function sideQueryOpenAI(opts: {
  model: string
  system?: string
  messages: Array<{ role: 'user' | 'assistant'; content: unknown }>
  tools?: Array<{ name: string; description?: string; input_schema?: unknown }>
  tool_choice?: { type: string; name?: string }
  output_format?: { schema?: Record<string, unknown> }
  max_tokens?: number
  maxRetries?: number
  signal?: AbortSignal
  temperature?: number
}): Promise<BetaMessage> {
  if (!isOpenAIModel(opts.model)) throw new Error(unsupportedModelMessage(opts.model))

  const model = normalizeOpenAIModelName(opts.model)
  const requestId = randomUUID()
  const sessionId = getSessionId()
  const creds = await getValidOpenAICredentials()

  const input: OpenAIInputItem[] = opts.messages.map(m => {
    if (typeof m.content === 'string') {
      return {
        type: 'message',
        role: m.role,
        content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }],
      }
    }
    if (Array.isArray(m.content)) {
      const parts = (m.content as Array<Record<string, unknown>>)
        .filter(b => b.type === 'text' && typeof b.text === 'string')
        .map(b => ({
          type: m.role === 'assistant' ? 'output_text' : 'input_text',
          text: b.text as string,
        }))
      return {
        type: 'message',
        role: m.role,
        content: parts.length > 0 ? parts : [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: JSON.stringify(m.content) }],
      }
    }
    return {
      type: 'message',
      role: m.role,
      content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: String(m.content ?? '') }],
    }
  })

  const openAITools: OpenAITool[] = (opts.tools ?? []).map(t => ({
    type: 'function',
    name: t.name,
    description: t.description ?? '',
    parameters: cleanJsonSchema(t.input_schema),
    strict: false,
  }))

  const bodyObj: Record<string, unknown> = {
    model,
    instructions: opts.system ?? '',
    input,
    // Separate cache lane from the main loop: side-query prefixes differ, so
    // sharing the session key would evict the main conversation's cache.
    prompt_cache_key: `${sessionId}:side`,
    stream: true,
    store: false,
    ...(openAITools.length > 0 ? { tools: openAITools } : {}),
    ...(opts.tool_choice
      ? {
          tool_choice:
            opts.tool_choice.type === 'tool' && opts.tool_choice.name
              ? { type: 'function', name: opts.tool_choice.name }
              : opts.tool_choice.type === 'any'
                ? 'required'
                : 'auto',
        }
      : {}),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.output_format?.schema
      ? {
          text: {
            format: {
              type: 'json_schema',
              name: 'structured_output',
              schema: cleanJsonSchema(opts.output_format.schema),
              strict: false,
            },
          },
        }
      : {}),
  }

  const jsonBody = JSON.stringify(bodyObj)
  const useZstd = creds.method !== 'api-key' && !creds.isCustomBaseURL
  const payload = useZstd ? zlib.zstdCompressSync(Buffer.from(jsonBody)) : jsonBody

  const response = await fetchOpenAIWithRetry({
    url: `${creds.baseURL}/responses`,
    payload,
    creds,
    maxRetries: opts.maxRetries ?? 2,
    signal: opts.signal,
    buildHeaders: (token, accountID) => ({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'User-Agent': `xCode/${MACRO.VERSION}`,
      originator: 'opencode',
      'session-id': sessionId,
      'thread-id': sessionId,
      'x-client-request-id': requestId,
      ...(accountID ? { 'chatgpt-account-id': accountID } : {}),
      ...(useZstd ? { 'Content-Encoding': 'zstd' } : {}),
    }),
  })

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => '')
    throw new Error(`OpenAI sideQuery error (${response.status}): ${errText.slice(0, 400)}`)
  }

  const contentBlocks: BetaContentBlock[] = []
  let stopReason: 'tool_use' | 'end_turn' = 'end_turn'
  let responseId = `resp_${requestId}`
  let usage = { ...EMPTY_USAGE }
  const activeText = new Map<string, string>()
  const activeTool = new Map<string, { callId: string; name: string; args: string }>()

  const abortController = new AbortController()
  const signal = opts.signal ?? abortController.signal

  for await (const { event, data } of parseSSE(response.body, signal)) {
    const d = (data ?? {}) as Record<string, unknown>
    if (event === 'response.created') {
      const r = d.response as Record<string, unknown> | undefined
      if (r && typeof r.id === 'string') responseId = r.id
    } else if (event === 'response.output_item.added') {
      const item = d.item as Record<string, unknown> | undefined
      if (!item || typeof item.id !== 'string') continue
      if (item.type === 'message') {
        activeText.set(item.id, '')
      } else if (item.type === 'function_call') {
        activeTool.set(item.id, {
          callId: typeof item.call_id === 'string' ? item.call_id : item.id,
          name: typeof item.name === 'string' ? item.name : 'unknown',
          args: '',
        })
      }
    } else if (event === 'response.output_text.delta') {
      const itemId = d.item_id as string | undefined
      const delta = d.delta as string | undefined
      if (itemId && typeof delta === 'string' && activeText.has(itemId)) {
        activeText.set(itemId, (activeText.get(itemId) ?? '') + delta)
      }
    } else if (event === 'response.function_call_arguments.delta') {
      const itemId = d.item_id as string | undefined
      const delta = d.delta as string | undefined
      const t = itemId ? activeTool.get(itemId) : undefined
      if (t && typeof delta === 'string') {
        t.args += delta
      }
    } else if (event === 'response.function_call_arguments.done') {
      const itemId = d.item_id as string | undefined
      const t = itemId ? activeTool.get(itemId) : undefined
      if (t && typeof d.arguments === 'string') {
        t.args = d.arguments
      }
    } else if (event === 'response.output_item.done') {
      const item = d.item as Record<string, unknown> | undefined
      if (!item || typeof item.id !== 'string') continue
      if (activeText.has(item.id)) {
        contentBlocks.push({ type: 'text', text: activeText.get(item.id) ?? '', citations: [] })
        activeText.delete(item.id)
      } else if (activeTool.has(item.id)) {
        const t = activeTool.get(item.id)!
        stopReason = 'tool_use'
        const rawArgs = typeof item.arguments === 'string' ? item.arguments : t.args
        let parsed: Record<string, unknown> = {}
        try {
          parsed = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {}
        } catch {
          parsed = {}
        }
        contentBlocks.push({ type: 'tool_use', id: t.callId, name: t.name, input: parsed })
        activeTool.delete(item.id)
      }
    } else if (event === 'response.completed' || event === 'response.done') {
      const resp = d.response as Record<string, unknown> | undefined
      const u = (resp?.usage ?? d.usage) as Record<string, unknown> | undefined
      if (u) {
        usage = extractOpenAIUsage(u) as typeof EMPTY_USAGE
      }
    } else if (event === 'response.failed' || event === 'error') {
      const errObj = (d.error ?? (d.response as Record<string, unknown> | undefined)?.error) as
        | Record<string, unknown>
        | undefined
      const msg = typeof errObj?.message === 'string' ? errObj.message : JSON.stringify(d)
      throw new Error(`OpenAI sideQuery failed: ${msg}`)
    }
  }

  return {
    id: responseId,
    type: 'message',
    role: 'assistant',
    model,
    content: contentBlocks,
    stop_reason: stopReason,
    stop_sequence: null,
    container: null,
    usage,
  } as unknown as BetaMessage
}
