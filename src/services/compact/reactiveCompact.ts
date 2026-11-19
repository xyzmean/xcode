import type { QuerySource } from '../../constants/querySource.js'
import type { Message } from '../../types/message.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import { logError } from '../../utils/log.js'
import { setLastSummarizedMessageId } from '../SessionMemory/sessionMemoryUtils.js'
import { compactConversation, type CompactionResult } from './compact.js'
import { runPostCompactCleanup } from './postCompactCleanup.js'

export async function tryReactiveCompact(params: {
  hasAttempted: boolean
  querySource: QuerySource
  messages: Message[]
  cacheSafeParams: CacheSafeParams
}): Promise<CompactionResult | null> {
  const { toolUseContext } = params.cacheSafeParams
  if (params.hasAttempted || toolUseContext.abortController.signal.aborted) {
    return null
  }
  try {
    const result = await compactConversation(
      params.messages,
      toolUseContext,
      params.cacheSafeParams,
      true,
      undefined,
      true,
    )
    setLastSummarizedMessageId(undefined)
    runPostCompactCleanup(params.querySource)
    return result
  } catch (error) {
    if (!toolUseContext.abortController.signal.aborted) logError(error)
    return null
  }
}
