import type { Command } from '../../types/command.js'
import { getActiveGoalState } from '../../utils/sessionGoal.js'

const loops = {
  type: 'local',
  name: 'loops',
  description: 'Show active session goal and running background monitors/tasks',
  supportsNonInteractive: true,
  userFacingName() {
    return 'loops'
  },
  isEnabled() {
    return true
  },
  isHidden: false,
  async load() {
    return {
      async call(_args: string, context) {
        const lines: string[] = []
        const goal = getActiveGoalState()
        if (goal) {
          lines.push(
            `Goal (${goal.paused ? 'paused' : 'active'}, ${goal.iterations} turns): ${goal.condition}`,
          )
        } else {
          lines.push('Goal: none')
        }

        const running = Object.values(context.getAppState().tasks).filter(
          t => t && (t.status === 'running' || t.status === 'pending'),
        )
        if (running.length > 0) {
          lines.push(`Running background tasks (${running.length}):`)
          for (const t of running) {
            lines.push(`- ${t.id} [${t.type}]: ${t.description ?? ''}`)
          }
        } else {
          lines.push('Running background tasks: none')
        }

        return {
          type: 'text' as const,
          value: lines.join('\n'),
        }
      },
    }
  },
} satisfies Command

export default loops
