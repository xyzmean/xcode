import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  getActiveGoalState,
  MAX_GOAL_LENGTH,
  setActiveGoal,
} from '../../utils/sessionGoal.js'
import { jsonStringify } from '../../utils/slowOperations.js'

const SET_GOAL_TOOL_NAME = 'SetGoal'

const WHEN_TO_USE =
  'Set a session goal, a stop check that keeps you working until it is met, when the user asks you to set one (such as by naming /goal or set_goal)'

const DESCRIPTION =
  'Set a session goal, a stop check that keeps the assistant working until it is met, asking the user first unless their own words stated it'

const PROMPT = `Set a completion condition for this session's work — a goal enforced by a stop check, which keeps you working until it is met (marked with <!-- GOAL_COMPLETE -->).

Set a goal only when the user has asked for an outcome with a verifiable end state ("make the tests pass", "migrate every call site") and the work spans multiple turns. Not for one-off tasks, and never to widen scope: the condition must follow from their request.

Once a goal is set, work toward it without asking what to do. It clears by itself once met, so do not tell the user to run /goal clear after success. GetGoal shows the goal in force, and PauseGoal can pause it if you are genuinely blocked on user input.

State one measurable end state with its check (e.g. "bun test exits 0"), in at most ${MAX_GOAL_LENGTH} characters. One stop-check goal is active at a time; setting a new goal replaces the current one.`

export const inputSchema = lazySchema(() =>
  z.object({
    condition: z
      .string()
      .min(1)
      .max(MAX_GOAL_LENGTH)
      .describe(
        `Clear completion condition for the session goal (at most ${MAX_GOAL_LENGTH} characters).`,
      ),
    ask_user: z
      .boolean()
      .optional()
      .describe('Whether to confirm with the user first.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() =>
  z.object({
    goal: z.string(),
    active: z.boolean(),
    replaced: z.boolean().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const SetGoalTool = buildTool({
  name: SET_GOAL_TOOL_NAME,
  aliases: ['ProposeGoal'],
  searchHint: 'set a persistent session goal enforced until completion (set_goal)',
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
    return input.condition
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
    return 'SetGoal'
  },
  renderToolUseMessage(input) {
    return `Setting goal: ${input.condition}`
  },
  async call(input) {
    const trimmed = input.condition.trim()
    if (!trimmed) {
      throw new Error('Goal condition cannot be empty.')
    }
    if (trimmed.length > MAX_GOAL_LENGTH) {
      throw new Error(
        `Goal condition is limited to ${MAX_GOAL_LENGTH} characters (got ${trimmed.length}).`,
      )
    }
    const hadPrevious = getActiveGoalState() !== undefined
    setActiveGoal(trimmed, 'model')
    return {
      data: {
        goal: trimmed,
        active: true,
        ...(hadPrevious ? { replaced: true } : {}),
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
