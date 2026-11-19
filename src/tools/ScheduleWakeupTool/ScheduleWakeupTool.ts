import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { enqueue } from '../../utils/messageQueueManager.js'
import { jsonStringify } from '../../utils/slowOperations.js'

const SCHEDULE_WAKEUP_TOOL_NAME = 'ScheduleWakeup'
const MIN_DELAY_SECONDS = 60
const MAX_DELAY_SECONDS = 3600

let activeWakeupTimer: ReturnType<typeof setTimeout> | null = null

const WHEN_TO_USE =
  'Schedule when to resume work in /loop dynamic mode (always pass the `prompt` arg unless stopping). Call before ending the turn to keep the loop alive.'

const DESCRIPTION = `Schedule a dynamic wakeup for /loop after \`delaySeconds\` (clamped to [60, 3600]), or pass \`stop: true\` to end the dynamic loop.`

const PROMPT = `Schedule when to resume work in /loop dynamic mode.

- Pass \`delaySeconds\` (clamped to [60, 3600]), \`reason\` (one short sentence), and \`prompt\` (the /loop input to fire on wake-up).
- Pass \`stop: true\` to cancel any pending wakeup and end the dynamic loop.`

export const inputSchema = lazySchema(() =>
  z.strictObject({
    delaySeconds: z
      .number()
      .optional()
      .describe(
        'Seconds from now to wake up. Clamped to [60, 3600] by the runtime. Required unless `stop` is true.',
      ),
    reason: z
      .string()
      .optional()
      .describe(
        'One short sentence explaining the chosen delay. Goes to telemetry and is shown to the user. Be specific. Required unless `stop` is true.',
      ),
    prompt: z
      .string()
      .optional()
      .describe(
        'The /loop input to fire on wake-up. Pass the same /loop input verbatim each turn so the next firing re-enters the skill and continues the loop. Required unless `stop` is true.',
      ),
    stop: z
      .boolean()
      .optional()
      .describe(
        'Set to true to end the dynamic loop immediately instead of scheduling another wakeup.',
      ),
    noop: z
      .boolean()
      .optional()
      .describe(
        'true = nothing changed; false = something happened worth keeping.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() =>
  z.object({
    scheduledFor: z.number(),
    clampedDelaySeconds: z.number(),
    wasClamped: z.boolean(),
    stopped: z.boolean().optional(),
    cancelledWakeups: z.number().optional(),
    reason: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const ScheduleWakeupTool = buildTool({
  name: SCHEDULE_WAKEUP_TOOL_NAME,
  searchHint: 'schedule or stop a dynamic /loop wakeup timer',
  whenToUse: WHEN_TO_USE,
  shouldDefer: true,
  maxResultSizeChars: 10_000,
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.stop
      ? 'stop'
      : `${input.delaySeconds ?? ''} ${input.reason ?? ''}`
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
    return 'ScheduleWakeup'
  },
  renderToolUseMessage(input) {
    if (input.stop) return 'Stopping dynamic loop'
    return `Scheduling wakeup in ${input.delaySeconds ?? MIN_DELAY_SECONDS}s`
  },
  async call(input) {
    let cancelledWakeups = 0
    if (activeWakeupTimer !== null) {
      clearTimeout(activeWakeupTimer)
      activeWakeupTimer = null
      cancelledWakeups = 1
    }

    if (input.stop) {
      return {
        data: {
          scheduledFor: 0,
          clampedDelaySeconds: 0,
          wasClamped: false,
          stopped: true,
          cancelledWakeups,
        },
      }
    }

    const promptText = input.prompt?.trim()
    if (!promptText) {
      throw new Error('`prompt` is required when `stop` is not true.')
    }
    if (input.delaySeconds === undefined || !input.reason?.trim()) {
      throw new Error(
        '`delaySeconds` and `reason` are required when `stop` is not true.',
      )
    }

    const rawDelay = input.delaySeconds
    const rounded = Number.isFinite(rawDelay)
      ? Math.round(rawDelay)
      : rawDelay === Infinity
        ? MAX_DELAY_SECONDS
        : MIN_DELAY_SECONDS
    const clampedDelay = Math.max(
      MIN_DELAY_SECONDS,
      Math.min(MAX_DELAY_SECONDS, rounded),
    )
    const wasClamped = !Number.isFinite(rawDelay) || rounded !== clampedDelay
    const scheduledFor = Date.now() + clampedDelay * 1000

    activeWakeupTimer = setTimeout(() => {
      activeWakeupTimer = null
      enqueue({
        value: promptText,
        mode: 'prompt',
      })
    }, clampedDelay * 1000)

    return {
      data: {
        scheduledFor,
        clampedDelaySeconds: clampedDelay,
        wasClamped,
        ...(input.reason ? { reason: input.reason.trim() } : {}),
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
