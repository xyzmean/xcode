export type CacheEditsBlock = {
  type: 'cache_edits'
  edits: Array<{ tool_use_id: string; summary: string }>
}

export type PinnedCacheEdits = {
  userMessageIndex: number
  block: CacheEditsBlock
}

export type CachedMCState = {
  pinnedEdits: PinnedCacheEdits[]
  clearedToolUseIds: Set<string>
  registeredTools: Set<string>
  toolOrder: string[]
  deletedRefs: Set<string>
}

export function createCachedMCState(): CachedMCState {
  return {
    pinnedEdits: [],
    clearedToolUseIds: new Set(),
    registeredTools: new Set(),
    toolOrder: [],
    deletedRefs: new Set(),
  }
}

export function isCachedMicrocompactEnabled(): boolean {
  // OpenAI Responses API uses automatic prefix caching via prompt_cache_key
  // rather than Anthropic-specific cache_edits blocks.
  return false
}

export function isModelSupportedForCacheEditing(_model?: string): boolean {
  return false
}

export function getCachedMCConfig(): {
  enabled: boolean
  minTokensToClear: number
  keepRecentToolUses: number
  triggerThreshold: number
  keepRecent: number
} {
  return {
    enabled: false,
    minTokensToClear: 40_000,
    keepRecentToolUses: 8,
    triggerThreshold: 40_000,
    keepRecent: 8,
  }
}

export function registerToolResult(state: CachedMCState, toolUseId: string): void {
  if (!state.registeredTools.has(toolUseId)) {
    state.registeredTools.add(toolUseId)
    state.toolOrder.push(toolUseId)
  }
}

export function registerToolMessage(_state: CachedMCState, _groupIds: string[]): void {}

export function getToolResultsToDelete(_state: CachedMCState): string[] {
  return []
}

export function createCacheEditsBlock(
  _state: CachedMCState,
  _toolsToDelete: string[],
): CacheEditsBlock | null {
  return null
}

export function resetCachedMCState(state: CachedMCState): void {
  state.pinnedEdits = []
  state.clearedToolUseIds.clear()
  state.registeredTools.clear()
  state.toolOrder = []
  state.deletedRefs.clear()
}
