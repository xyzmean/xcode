import { z } from 'zod/v4'
import { snipCompactIfNeeded } from '../../services/compact/snipCompact.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'

const SNIP_TOOL_NAME = 'Snip'

const DESCRIPTION = `Trim oversized tool outputs from older messages in the current conversation to free up context tokens.`

export const inputSchema = lazySchema(() => z.strictObject({}))
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() =>
  z.object({
    tokensFreed: z.number(),
    messageCount: z.number(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const SnipTool = buildTool({
  name: SNIP_TOOL_NAME,
  searchHint: 'trim oversized tool results from older messages to free context',
  shouldDefer: true,
  maxResultSizeChars: 10_000,
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput() {
    return ''
  },
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return DESCRIPTION
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'Snip'
  },
  renderToolUseMessage() {
    return 'Snipping older tool outputs'
  },
  async call(_input, context) {
    const msgs = context.messages ?? []
    const res = snipCompactIfNeeded(msgs)
    return {
      data: {
        tokensFreed: res.tokensFreed,
        messageCount: res.messages.length,
      },
    }
  },
  mapToolResultToToolResultBlockParam(data, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify(data),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
