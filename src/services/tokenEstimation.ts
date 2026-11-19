import type { Anthropic } from '@anthropic-ai/sdk'
import type { Attachment } from '../utils/attachments.js'
import { normalizeAttachmentForAPI } from '../utils/messages.js'
import { jsonStringify } from '../utils/slowOperations.js'

export function estimateSerializedTokens(
  messages: readonly Anthropic.Beta.Messages.BetaMessageParam[],
  tools: readonly Anthropic.Beta.Messages.BetaToolUnion[] = [],
): number {
  return roughTokenCountEstimation(
    jsonStringify(messages) + (tools.length > 0 ? jsonStringify(tools) : ''),
  )
}

export function roughTokenCountEstimation(
  content: string,
  bytesPerToken: number = 4,
): number {
  return Math.round(content.length / bytesPerToken)
}

/**
 * Returns an estimated bytes-per-token ratio for a given file extension.
 * Dense JSON has many single-character tokens (`{`, `}`, `:`, `,`, `"`)
 * which makes the real ratio closer to 2 rather than the default 4.
 */
export function bytesPerTokenForFileType(fileExtension: string): number {
  switch (fileExtension) {
    case 'json':
    case 'jsonl':
    case 'jsonc':
      return 2
    default:
      return 4
  }
}

export function roughTokenCountEstimationForFileType(
  content: string,
  fileExtension: string,
): number {
  return roughTokenCountEstimation(
    content,
    bytesPerTokenForFileType(fileExtension),
  )
}

/**
 * Estimates token count for a Message object by extracting and analyzing its text content.
 * This provides a more reliable estimate than getTokenUsage for messages that may have been compacted.
 */
export function roughTokenCountEstimationForMessages(
  messages: readonly {
    type: string
    message?: { content?: unknown }
    attachment?: Attachment
  }[],
): number {
  let totalTokens = 0
  for (const message of messages) {
    totalTokens += roughTokenCountEstimationForMessage(message)
  }
  return totalTokens
}

export function roughTokenCountEstimationForMessage(message: {
  type: string
  message?: { content?: unknown }
  attachment?: Attachment
}): number {
  if (
    (message.type === 'assistant' || message.type === 'user') &&
    message.message?.content
  ) {
    return roughTokenCountEstimationForContent(
      message.message?.content as
        | string
        | Array<Anthropic.ContentBlock>
        | Array<Anthropic.ContentBlockParam>
        | undefined,
    )
  }

  if (message.type === 'attachment' && message.attachment) {
    const userMessages = normalizeAttachmentForAPI(message.attachment)
    let total = 0
    for (const userMsg of userMessages) {
      total += roughTokenCountEstimationForContent(userMsg.message.content)
    }
    return total
  }

  return 0
}

function roughTokenCountEstimationForContent(
  content:
    | string
    | Array<Anthropic.ContentBlock>
    | Array<Anthropic.ContentBlockParam>
    | undefined,
): number {
  if (!content) {
    return 0
  }
  if (typeof content === 'string') {
    return roughTokenCountEstimation(content)
  }
  let totalTokens = 0
  for (const block of content) {
    totalTokens += roughTokenCountEstimationForBlock(block)
  }
  return totalTokens
}

function roughTokenCountEstimationForBlock(
  block: string | Anthropic.ContentBlock | Anthropic.ContentBlockParam,
): number {
  if (typeof block === 'string') {
    return roughTokenCountEstimation(block)
  }
  if (block.type === 'text') {
    return roughTokenCountEstimation(block.text)
  }
  if (block.type === 'image' || block.type === 'document') {
    // Match microCompact's tool-result estimate instead of counting base64 as text.
    return 2000
  }
  if (block.type === 'tool_result') {
    return roughTokenCountEstimationForContent(block.content)
  }
  if (block.type === 'tool_use') {
    return roughTokenCountEstimation(
      block.name + jsonStringify(block.input ?? {}),
    )
  }
  if (block.type === 'thinking') {
    return roughTokenCountEstimation(block.thinking)
  }
  if (block.type === 'redacted_thinking') {
    return roughTokenCountEstimation(block.data)
  }
  return roughTokenCountEstimation(jsonStringify(block))
}
