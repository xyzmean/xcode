import type { Command } from '../../commands.js'
import { hasOpenAIAuth } from '../../services/oauth/openai.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

export default () =>
  ({
    type: 'local-jsx',
    name: 'login',
    description: hasOpenAIAuth()
      ? 'Switch ChatGPT accounts'
      : 'Sign in with ChatGPT',
    isEnabled: () => !isEnvTruthy(process.env.DISABLE_LOGIN_COMMAND),
    load: () => import('./login.js'),
  }) satisfies Command
