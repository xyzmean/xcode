import type { Command } from '../../types/command.js'
import { formatDuration } from '../../utils/format.js'

const listAgents = {
  type: 'local',
  name: 'list-agents',
  description: 'List active and recent subagents in this session',
  supportsNonInteractive: true,
  userFacingName() {
    return 'list-agents'
  },
  isEnabled() {
    return true
  },
  isHidden: false,
  async load() {
    return {
      async call(_args: string, context) {
        const state = context.getAppState()
        const nameById = new Map<string, string>()
        for (const [name, id] of state.agentNameRegistry.entries()) {
          nameById.set(id, name)
        }
        const lines: string[] = []
        const now = Date.now()
        for (const [id, task] of Object.entries(state.tasks)) {
          if (!task) continue
          if (
            task.type !== 'local_agent' &&
            task.type !== 'remote_agent' &&
            task.type !== 'in_process_teammate'
          ) {
            continue
          }
          const name =
            nameById.get(id) ??
            (task.type === 'in_process_teammate'
              ? task.identity.agentName
              : undefined)
          const elapsed = formatDuration(
            Math.max(0, (task.endTime ?? now) - task.startTime),
          )
          const desc = task.description ? `: ${task.description}` : ''
          lines.push(
            `- ${name ? `@${name} (${id})` : id} [${task.status}] ${elapsed}${desc}`,
          )
        }
        return {
          type: 'text' as const,
          value:
            lines.length > 0
              ? `Subagents (${lines.length}):\n${lines.join('\n')}`
              : 'No active or recent subagents in this session.',
        }
      },
    }
  },
} satisfies Command

export default listAgents
