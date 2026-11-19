import type { Command } from '../../types/command.js'
import { enqueue } from '../../utils/messageQueueManager.js'
import {
  clearActiveGoal,
  getActiveGoalState,
  MAX_USER_GOAL_LENGTH,
  setActiveGoal,
} from '../../utils/sessionGoal.js'

const CLEAR_KEYWORDS = new Set([
  'clear',
  'stop',
  'off',
  'reset',
  'none',
  'cancel',
])

const goal = {
  type: 'local',
  name: 'goal',
  description: 'Set, check, or cancel a persistent session goal',
  argumentHint: '<goal description | status | clear>',
  supportsNonInteractive: true,
  userFacingName() {
    return 'goal'
  },
  isEnabled() {
    return true
  },
  isHidden: false,
  async load() {
    return {
      async call(args: string) {
        const trimmed = args.trim()
        const lower = trimmed.toLowerCase()

        if (!trimmed || lower === 'status') {
          const current = getActiveGoalState()
          if (!current) {
            return {
              type: 'text' as const,
              value: 'No goal set. Usage: `/goal <condition>`',
            }
          }
          const turns =
            current.iterations === 0
              ? 'not yet evaluated'
              : `${current.iterations} ${current.iterations === 1 ? 'turn' : 'turns'}`
          const lastCheck = current.lastReason
            ? `\nLast check: ${current.lastReason.trim()}`
            : ''
          return {
            type: 'text' as const,
            value: current.paused
              ? `Goal paused: ${current.condition} (${turns})${lastCheck}\nSend a message to continue, or run /goal clear.\nReason: ${current.paused.reason}`
              : `Goal active: ${current.condition} (${turns})${lastCheck}`,
          }
        }

        if (CLEAR_KEYWORDS.has(lower)) {
          const cleared = clearActiveGoal()
          return {
            type: 'text' as const,
            value: cleared === null ? 'No goal set' : `Goal cleared: ${cleared}`,
          }
        }

        if (trimmed.length > MAX_USER_GOAL_LENGTH) {
          return {
            type: 'text' as const,
            value: `Goal condition is limited to ${MAX_USER_GOAL_LENGTH} characters (got ${trimmed.length})`,
          }
        }

        setActiveGoal(trimmed, 'user')
        enqueue({
          value: `A session-scoped goal is now active with condition: "${trimmed}". Briefly acknowledge the goal, then immediately start (or continue) working toward it — treat the condition itself as your directive and do not pause to ask the user what to do. The stop check will keep you working until the condition holds. Once complete, include <!-- GOAL_COMPLETE --> in your final response (it auto-clears once met — do not tell the user to run \`/goal clear\` after success). If blocked on something only the user can resolve, call PauseGoal.`,
          mode: 'prompt',
        })
        return {
          type: 'text' as const,
          value: `Goal set: ${trimmed}`,
        }
      },
    }
  },
} satisfies Command

export default goal
