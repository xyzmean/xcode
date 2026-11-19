import type { Message } from '../../types/message.js'
import { roughTokenCountEstimation } from '../tokenEstimation.js'

export type SnipResult = {
  messages: Message[]
  tokensFreed: number
  boundaryMessage?: Message
}

const SNIP_KEEP_TAIL_MESSAGES = 24
const SNIP_TRIGGER_TOKENS = 120_000

/**
 * Trim oversized tool_result contents from older messages beyond the protected tail.
 */
export function snipCompactIfNeeded(messages: Message[]): SnipResult {
  if (messages.length <= SNIP_KEEP_TAIL_MESSAGES) {
    return { messages, tokensFreed: 0 }
  }

  let estimated = 0
  for (const m of messages) {
    estimated += roughTokenCountEstimation(JSON.stringify(m))
  }
  if (estimated < SNIP_TRIGGER_TOKENS) {
    return { messages, tokensFreed: 0 }
  }

  const cutoff = messages.length - SNIP_KEEP_TAIL_MESSAGES
  let tokensFreed = 0
  const next = messages.map((msg, idx) => {
    if (idx >= cutoff || msg.type !== 'user') return msg
    const content = (msg as { message?: { content?: unknown } }).message?.content
    if (!Array.isArray(content)) return msg
    let changed = false
    const updatedContent = content.map((block: unknown) => {
      if (
        block &&
        typeof block === 'object' &&
        (block as { type?: string }).type === 'tool_result'
      ) {
        const b = block as { content?: unknown }
        if (typeof b.content === 'string' && b.content.length > 800) {
          tokensFreed += roughTokenCountEstimation(b.content) - 20
          changed = true
          return {
            ...b,
            content: `${b.content.slice(0, 400)}\n... [snipped ${b.content.length - 400} chars]`,
          }
        }
      }
      return block
    })
    if (!changed) return msg
    return {
      ...msg,
      message: {
        ...(msg as { message: Record<string, unknown> }).message,
        content: updatedContent,
      },
    } as Message
  })

  return { messages: next, tokensFreed }
}

export function isSnipMarkerMessage(_msg: Message): boolean {
  return false
}
