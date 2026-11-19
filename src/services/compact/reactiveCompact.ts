import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  compactConversation,
  type CompactionResult,
} from './compact.js'

export function isReactiveCompactEnabled(): boolean {
  return !isEnvTruthy(process.env.DISABLE_AUTO_COMPACT)
}

export function isReactiveOnlyMode(): boolean {
  return false
}

export function isWithheldPromptTooLong(msg: unknown): boolean {
  if (!msg || typeof msg !== 'object') return false
  const m = msg as {
    type?: string
    isApiErrorMessage?: boolean
    errorDetails?: { type?: string }
  }
  return (
    m.type === 'assistant' &&
    m.isApiErrorMessage === true &&
    m.errorDetails?.type === 'prompt_too_long'
  )
}

export function isWithheldMediaSizeError(msg: unknown): boolean {
  if (!msg || typeof msg !== 'object') return false
  const m = msg as {
    type?: string
    isApiErrorMessage?: boolean
    errorDetails?: { type?: string }
  }
  return (
    m.type === 'assistant' &&
    m.isApiErrorMessage === true &&
    m.errorDetails?.type === 'media_too_large'
  )
}

export async function reactiveCompactOnPromptTooLong(
  messages: Message[],
  context: ToolUseContext,
  options?: { customInstructions?: string; trigger?: 'manual' | 'auto' },
): Promise<{ ok: true; result: CompactionResult } | { ok: false }> {
  try {
    const result = await compactConversation(
      messages,
      context,
      undefined,
      options?.trigger === 'auto',
      options?.customInstructions,
    )
    return { ok: true, result }
  } catch {
    return { ok: false }
  }
}

export async function tryReactiveCompact(params: {
  hasAttempted: boolean
  querySource?: string
  aborted: boolean
  messages: Message[]
  toolUseContext: ToolUseContext
}): Promise<CompactionResult | null> {
  if (params.hasAttempted || params.aborted || !isReactiveCompactEnabled()) {
    return null
  }
  const outcome = await reactiveCompactOnPromptTooLong(
    params.messages,
    params.toolUseContext,
    { trigger: 'auto' },
  )
  return outcome.ok ? outcome.result : null
}
