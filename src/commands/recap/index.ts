import type { Command } from '../../types/command.js'
import { enqueue } from '../../utils/messageQueueManager.js'

const recap = {
  type: 'local',
  name: 'recap',
  description: 'Summarize what has been accomplished and what remains in this session',
  supportsNonInteractive: true,
  userFacingName() {
    return 'recap'
  },
  isEnabled() {
    return true
  },
  isHidden: false,
  async load() {
    return {
      async call() {
        enqueue({
          value:
            'Provide a concise recap of this session: (1) what was completed and verified, (2) any open issues or blockers, and (3) recommended next steps.',
          mode: 'prompt',
        })
        return {
          type: 'text' as const,
          value: 'Requested session recap.',
        }
      },
    }
  },
} satisfies Command

export default recap
