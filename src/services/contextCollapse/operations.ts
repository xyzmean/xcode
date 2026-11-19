import type { Message } from '../../types/message.js'

export function projectView<T extends readonly Message[]>(messages: T): T {
  return messages
}
