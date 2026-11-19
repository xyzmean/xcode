import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

const END_CONVERSATION_TOOL_NAME = 'EndConversation'

const WHEN_TO_USE =
  'When the user keeps abusing you after repeated warnings, not merely swearing in frustration, or confirms they want the conversation permanently ended, use it; never for a finished or failing task, or if the user may harm themselves or others.'

const DESCRIPTION = `End the current conversation cleanly when the user explicitly confirms they want the conversation ended, or in response to sustained abuse after repeated warnings. Never use for a finished or failing task.`

export const inputSchema = lazySchema(() => z.strictObject({}))
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() =>
  z.object({
    ended: z.boolean(),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const EndConversationTool = buildTool({
  name: END_CONVERSATION_TOOL_NAME,
  searchHint: 'end the conversation — for sustained user abuse, or when the user requests it',
  whenToUse: WHEN_TO_USE,
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
    return 'EndConversation'
  },
  renderToolUseMessage() {
    return null
  },
  async call(_input, context) {
    if (context?.agentId) {
      return {
        data: {
          ended: false,
          message:
            'EndConversation is only available in the main conversation, not inside a subagent.',
        },
      }
    }
    context.abortController?.abort('end_conversation')
    return {
      data: {
        ended: true,
        message: 'Conversation ended.',
      },
    }
  },
  mapToolResultToToolResultBlockParam(data, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: data.message,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
