import type { Command } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'

const autocompact = {
  type: 'local',
  name: 'autocompact',
  description: 'Show or toggle automatic context compaction (on | off)',
  argumentHint: '[on | off | status]',
  supportsNonInteractive: true,
  userFacingName() {
    return 'autocompact'
  },
  isEnabled() {
    return true
  },
  isHidden: false,
  async load() {
    return {
      async call(args: string) {
        const arg = args.trim().toLowerCase()
        const current = getGlobalConfig().autoCompactEnabled ?? true
        if (!arg || arg === 'status') {
          return {
            type: 'text' as const,
            value: `Auto-compact is currently ${current ? 'enabled' : 'disabled'}. Usage: /autocompact <on|off>`,
          }
        }
        if (arg === 'on' || arg === 'true' || arg === 'enable') {
          saveGlobalConfig(prev => ({ ...prev, autoCompactEnabled: true }))
          return {
            type: 'text' as const,
            value: 'Auto-compact enabled.',
          }
        }
        if (arg === 'off' || arg === 'false' || arg === 'disable') {
          saveGlobalConfig(prev => ({ ...prev, autoCompactEnabled: false }))
          return {
            type: 'text' as const,
            value: 'Auto-compact disabled.',
          }
        }
        return {
          type: 'text' as const,
          value: `Unknown option "${arg}". Usage: /autocompact <on|off|status>`,
        }
      },
    }
  },
} satisfies Command

export default autocompact
