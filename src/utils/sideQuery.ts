import type Anthropic from '@anthropic-ai/sdk'
import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages.js'
import type { QuerySource } from '../constants/querySource.js'
import { sideQueryOpenAI } from '../services/api/openai.js'

export type SideQueryOptions = {
  model: string
  system?: string | Anthropic.TextBlockParam[]
  messages: Anthropic.MessageParam[]
  tools?: Anthropic.Tool[] | BetaToolUnion[]
  tool_choice?: Anthropic.ToolChoice
  output_format?: Anthropic.Beta.Messages.BetaJSONOutputFormat
  max_tokens?: number
  maxRetries?: number
  signal?: AbortSignal
  skipSystemPromptPrefix?: boolean
  temperature?: number
  thinking?: number | false
  stop_sequences?: string[]
  querySource: QuerySource
}

export function sideQuery(opts: SideQueryOptions): Promise<Anthropic.Beta.Messages.BetaMessage> {
  return sideQueryOpenAI({
    model: opts.model,
    system: typeof opts.system === 'string'
      ? opts.system
      : opts.system?.map(block => block.text).filter(Boolean).join('\n\n'),
    messages: opts.messages,
    tools: opts.tools?.flatMap(tool => 'input_schema' in tool ? [tool] : []),
    tool_choice: opts.tool_choice,
    output_format: opts.output_format,
    max_tokens: opts.max_tokens,
    maxRetries: opts.maxRetries,
    signal: opts.signal,
    temperature: opts.temperature,
  })
}
