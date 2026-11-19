import { useCallback, useState } from 'react'
import { hasOpenAIAuth } from '../services/oauth/openai.js'

export type OpenAIAuthStatus = 'configured' | 'missing'

function getStatus(): OpenAIAuthStatus {
  return hasOpenAIAuth() ? 'configured' : 'missing'
}

export function useOpenAIAuthStatus() {
  const [status, setStatus] = useState(getStatus)
  const refresh = useCallback(() => setStatus(getStatus()), [])
  return { status, refresh }
}
