import type { Task, TaskStateBase } from '../types.js'

export interface MonitorMcpTaskState extends TaskStateBase {
  type: 'monitor_mcp'
  agentId?: string
  serverName?: string
  command?: string
}

const activeControllers = new Map<string, { agentId?: string; abort: AbortController }>()

export function registerMonitorMcpController(
  taskId: string,
  agentId: string | undefined,
  abort: AbortController,
): void {
  activeControllers.set(taskId, { agentId, abort })
}

export function unregisterMonitorMcpController(taskId: string): void {
  activeControllers.delete(taskId)
}

export function killMonitorMcpTasksForAgent(
  agentId: string,
  _setAppState?: unknown,
): void {
  for (const [id, entry] of activeControllers.entries()) {
    if (entry.agentId === agentId) {
      entry.abort.abort()
      activeControllers.delete(id)
    }
  }
}

export const MonitorMcpTask: Task = {
  name: 'MonitorMcpTask',
  type: 'monitor_mcp',
  async kill(taskId: string) {
    const entry = activeControllers.get(taskId)
    if (entry) {
      entry.abort.abort()
      activeControllers.delete(taskId)
    }
  },
}
