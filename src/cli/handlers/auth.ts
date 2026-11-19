/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handler intentionally exits */

import {
  clearOpenAIOAuthTokens,
  getOpenAIAuthMethod,
  loginWithOpenAIOAuth,
} from '../../services/oauth/openai.js'
import { errorMessage } from '../../utils/errors.js'
import { jsonStringify } from '../../utils/slowOperations.js'

export async function authLogin({ codex }: { codex?: boolean }): Promise<void> {
  const method = codex ? 'codex-browser' : 'chatgpt-token-sharing'
  try {
    await loginWithOpenAIOAuth({
      method,
      onUrl: url => {
        process.stdout.write(`Open this URL in your browser to sign in with ChatGPT:\n${url}\n`)
      },
    })
    process.stdout.write(`Successfully signed in with ChatGPT (${method}).\n`)
    process.exit(0)
  } catch (error) {
    process.stderr.write(`ChatGPT sign-in failed: ${errorMessage(error)}\n`)
    process.exit(1)
  }
}

export function authStatus({ text }: { text?: boolean }): void {
  const method = getOpenAIAuthMethod()
  const loggedIn = method !== null
  if (text) {
    const message =
      method === 'api-key'
        ? 'API key: OPENAI_API_KEY'
        : method
          ? `Signed in with ChatGPT (${method}).`
          : 'Not signed in. Run xcode auth login or set OPENAI_API_KEY.'
    process.stdout.write(`${message}\n`)
  } else {
    const output = {
      loggedIn,
      authMethod: method === 'api-key' ? 'openai_api_key' : method ? `openai_${method}` : 'none',
      apiProvider: 'openai',
      ...(method === 'api-key' && { apiKeySource: 'OPENAI_API_KEY' }),
    }
    process.stdout.write(jsonStringify(output, null, 2) + '\n')
  }
  process.exit(loggedIn ? 0 : 1)
}

export function authLogout(): void {
  try {
    clearOpenAIOAuthTokens()
  } catch (error) {
    process.stderr.write(`Failed to sign out: ${errorMessage(error)}\n`)
    process.exit(1)
  }
  process.stdout.write('Stored ChatGPT credentials cleared.\n')
  if (process.env.OPENAI_API_KEY) {
    process.stdout.write('Unset OPENAI_API_KEY to stop signing in with the environment API key.\n')
  }
  process.exit(0)
}
