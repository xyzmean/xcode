import { randomUUID } from 'crypto'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  dequeueAllMatching,
  peek,
} from '../../utils/messageQueueManager.js'
import { jsonStringify } from '../../utils/slowOperations.js'

const READ_NOTIFICATIONS_TOOL_NAME = 'ReadNotifications'

const WHEN_TO_USE =
  'Drain and read queued background notifications (monitor events, scheduled wakeups, or background task completions) from the session buffer.'

const DESCRIPTION = `Drain and read queued background notifications (such as monitor events or background task completions) from the session notification buffer.`

const PROMPT = `Read and drain queued background notifications from the main conversation buffer.

Only available from the main conversation — subagents must not drain the session notification buffer.`

export const inputSchema = lazySchema(() => z.strictObject({}))
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() =>
  z.object({
    notifications: z.array(
      z.object({
        notification_id: z.string(),
        mode: z.string(),
        content: z.string(),
        origin: z.string().optional(),
        queued_at: z.string(),
      }),
    ),
    remaining: z.number(),
    read_at: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const ReadNotificationsTool = buildTool({
  name: READ_NOTIFICATIONS_TOOL_NAME,
  searchHint: 'read queued background notifications',
  whenToUse: WHEN_TO_USE,
  shouldDefer: true,
  maxResultSizeChars: 50_000,
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput() {
    return 'read queued notifications'
  },
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'ReadNotifications'
  },
  renderToolUseMessage() {
    return ''
  },
  async call(_input, context) {
    if (context.agentId !== undefined) {
      throw new Error(
        'ReadNotifications can only be called from the main conversation — subagents must not drain the session notification buffer.',
      )
    }

    const now = new Date().toISOString()
    const drained = dequeueAllMatching(cmd => cmd.mode === 'task-notification')
    const notifications = drained.map(cmd => ({
      notification_id: randomUUID(),
      mode: cmd.mode,
      content:
        typeof cmd.value === 'string' ? cmd.value : jsonStringify(cmd.value),
      ...(cmd.origin ? { origin: String(cmd.origin) } : {}),
      queued_at: now,
    }))

    return {
      data: {
        notifications,
        remaining: peek()?.mode === 'task-notification' ? 1 : 0,
        read_at: now,
      },
    }
  },
  mapToolResultToToolResultBlockParam(data, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content:
        data.notifications.length === 0
          ? `No queued notifications at ${data.read_at}.`
          : jsonStringify(data),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
