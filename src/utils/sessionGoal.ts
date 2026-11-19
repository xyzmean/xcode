const MAX_GOAL_CONTINUATIONS = 12
export const MAX_GOAL_LENGTH = 500
export const MAX_USER_GOAL_LENGTH = 4000

export type ActiveGoalState = {
  condition: string
  iterations: number
  setAt: number
  origin: 'user' | 'model'
  lastReason?: string
  paused?: {
    reason: string
  }
}

let activeGoalState: ActiveGoalState | undefined

export function getActiveGoalState(): ActiveGoalState | undefined {
  return activeGoalState
}

export function getActiveGoal(): string | null {
  return activeGoalState?.condition ?? null
}

export function setActiveGoal(
  condition: string,
  origin: 'user' | 'model' = 'user',
): void {
  const trimmed = condition.trim()
  if (!trimmed) {
    activeGoalState = undefined
    return
  }
  activeGoalState = {
    condition: trimmed,
    iterations: 0,
    setAt: Date.now(),
    origin,
  }
}

export function clearActiveGoal(): string | null {
  const prev = activeGoalState?.condition ?? null
  activeGoalState = undefined
  return prev
}

export function pauseActiveGoal(reason: string): boolean {
  if (!activeGoalState || activeGoalState.paused) {
    return false
  }
  activeGoalState = {
    ...activeGoalState,
    paused: { reason: reason.trim() },
  }
  return true
}

export function resumeActiveGoal(): boolean {
  if (!activeGoalState?.paused) {
    return false
  }
  const { paused: _paused, ...rest } = activeGoalState
  activeGoalState = rest
  return true
}

export function setGoalLastReason(reason: string): void {
  if (!activeGoalState) return
  activeGoalState = {
    ...activeGoalState,
    lastReason: reason.trim(),
  }
}

export function incrementGoalContinuation(): boolean {
  if (!activeGoalState) return false
  if (activeGoalState.paused) return false
  if (activeGoalState.iterations >= MAX_GOAL_CONTINUATIONS) {
    activeGoalState = undefined
    return false
  }
  activeGoalState = {
    ...activeGoalState,
    iterations: activeGoalState.iterations + 1,
  }
  return true
}
