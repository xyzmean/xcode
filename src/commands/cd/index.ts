import { existsSync, statSync } from 'fs'
import { homedir } from 'os'
import path from 'path'
import type { Command } from '../../types/command.js'
import { getCwd } from '../../utils/cwd.js'
import { setCwd } from '../../utils/Shell.js'

const cd = {
  type: 'local',
  name: 'cd',
  description: 'Change the current working directory',
  argumentHint: '<path>',
  supportsNonInteractive: true,
  userFacingName() {
    return 'cd'
  },
  isEnabled() {
    return true
  },
  isHidden: false,
  async load() {
    return {
      async call(args: string) {
        const raw = args.trim()
        if (!raw) {
          return {
            type: 'text' as const,
            value: `Current working directory: ${getCwd()}`,
          }
        }
        const expanded = raw.startsWith('~')
          ? path.join(homedir(), raw.slice(1))
          : raw
        const resolved = path.resolve(getCwd(), expanded)
        if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
          return {
            type: 'text' as const,
            value: `Directory not found: ${resolved}`,
          }
        }
        setCwd(resolved)
        return {
          type: 'text' as const,
          value: `Changed directory to ${getCwd()}`,
        }
      },
    }
  },
} satisfies Command

export default cd
