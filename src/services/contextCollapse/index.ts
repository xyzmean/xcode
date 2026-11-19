import type { Message } from '../../types/message.js'
import type { ToolUseContext } from '../../Tool.js'

export type ContextCollapseStats = {
  collapsedSpans: number
  stagedSpans: number
  health: {
    totalErrors: number
    totalEmptySpawns: number
    emptySpawnWarningEmitted: boolean
  }
}

const listeners = new Set<() => void>()
const stats: ContextCollapseStats = {
  collapsedSpans: 0,
  stagedSpans: 0,
  health: {
    totalErrors: 0,
    totalEmptySpawns: 0,
    emptySpawnWarningEmitted: false,
  },
}

export function getStats(): ContextCollapseStats {
  return {
    ...stats,
    health: { ...stats.health },
  }
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function isContextCollapseEnabled(): boolean {
  return false
}

export async function applyCollapsesIfNeeded(
  messages: Message[],
  _context?: ToolUseContext,
  _querySource?: string,
): Promise<{ messages: Message[]; collapsed: boolean }> {
  return { messages, collapsed: false }
}

export function isWithheldPromptTooLong(_error: unknown): boolean {
  return false
}

export function initContextCollapse(): void {
  // Initialized lazily; state starts empty.
}

export function recoverFromOverflow(
  messages: Message[],
  _querySource?: string,
): { messages: Message[]; committed: number } {
  return { messages, committed: 0 }
}

export function resetContextCollapse(): void {
  stats.collapsedSpans = 0
  stats.stagedSpans = 0
  for (const l of listeners) l()
}
