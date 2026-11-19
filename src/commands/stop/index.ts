import type { Command } from '../../types/command.js'
import { killTask } from '../../tasks/LocalShellTask/killShellTasks.js'
import { killAsyncAgent } from '../../tasks/LocalAgentTask/LocalAgentTask.js'

const stop = {
  type: 'local',
  name: 'stop',
  description: 'Stop all running background agents/shells/monitors or a specific task ID',
  argumentHint: '[taskId]',
  supportsNonInteractive: true,
  userFacingName() {
    return 'stop'
  },
  isEnabled() {
    return true
  },
  isHidden: false,
  async load() {
    return {
      async call(args: string, context) {
        const targetId = args.trim()
        const state = context.getAppState()
        const tasks = Object.values(state.tasks)
        let stopped = 0

        for (const task of tasks) {
          if (!task || task.status !== 'running') continue
          if (targetId && task.id !== targetId) continue
          if (task.type === 'local_bash') {
            killTask(task.id, context.setAppState)
            stopped++
          } else if (task.type === 'local_agent') {
            killAsyncAgent(task.id, context.setAppState)
            stopped++
          }
        }

        if (stopped === 0) {
          return {
            type: 'text' as const,
            value: targetId
              ? `No running task found with ID "${targetId}".`
              : 'No running background tasks to stop.',
          }
        }
        return {
          type: 'text' as const,
          value: `Stopped ${stopped} running background ${stopped === 1 ? 'task' : 'tasks'}.`,
        }
      },
    }
  },
} satisfies Command

export default stop
