import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getActiveGoalState } from '../../utils/sessionGoal.js'

const GET_GOAL_TOOL_NAME = 'GetGoal'

const WHEN_TO_USE =
  'Read the session goal, the stop check set by /goal or SetGoal, and the last reason it was not met'

const DESCRIPTION =
  "Read the /goal stop check's condition and the last reason it isn't met"

const PROMPT =
  "Read the session goal — the stop check that keeps you working until its condition is met — and the last reason it isn't met. Says so when no goal is active. Use this when you have lost track of the goal, for example after the conversation was summarized."

export const inputSchema = lazySchema(() => z.object({}))
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() =>
  z.object({
    condition: z
      .string()
      .nullable()
      .describe('The goal condition, or null when no goal is active'),
    lastReason: z
      .string()
      .optional()
      .describe("The last reason the goal isn't met"),
    paused: z
      .boolean()
      .optional()
      .describe("Whether the goal is paused until the user's next message"),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const GetGoalTool = buildTool({
  name: GET_GOAL_TOOL_NAME,
  searchHint: 'read the current session goal and its last check (get_goal)',
  whenToUse: WHEN_TO_USE,
  shouldDefer: true,
  maxResultSizeChars: 10_000,
  isEnabled() {
    return true
  },
  isConcurrencySafe() {
    return true
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
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'GetGoal'
  },
  renderToolUseMessage() {
    return 'Read the session goal'
  },
  async call() {
    const goal = getActiveGoalState()
    return {
      data: {
        condition: goal?.condition ?? null,
        ...(goal?.lastReason !== undefined
          ? { lastReason: goal.lastReason }
          : {}),
        ...(goal?.paused ? { paused: true } : {}),
      },
    }
  },
  mapToolResultToToolResultBlockParam(data, toolUseID) {
    const content =
      data.condition === null
        ? 'No goal set with /goal or SetGoal is active.'
        : `Session goal: ${data.condition}${
            data.paused === true
              ? "\nIt is paused until the user's next message."
              : ''
          }${
            data.lastReason === undefined
              ? ''
              : `\nThe last reason it isn't met: ${data.lastReason}`
          }`
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
