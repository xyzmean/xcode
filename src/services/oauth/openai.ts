import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { openBrowser } from '../../utils/browser.js'
import { logForDebugging } from '../../utils/debug.js'

const ISSUER = 'https://auth.openai.com'
const TOKEN_SHARING_URL = `${ISSUER}/api/accounts/oauth/token`
const CODEX_TOKEN_URL = `${ISSUER}/oauth/token`
const REGISTRATION_CLIENT_ID = 'dynamic_agent_client'
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const TOKEN_SHARING_SCOPE = 'chatgpt.tokens.use.direct'
export const OPENAI_API_BASE_URL = 'https://api.openai.com/v1'
export const CODEX_API_BASE_URL = 'https://chatgpt.com/backend-api/codex'

export type OpenAIAuthMethod = 'chatgpt-token-sharing' | 'codex-browser'

export type OpenAIOAuthTokens = {
  method: OpenAIAuthMethod
  accessToken: string
  refreshToken: string
  expiresAt: number
  clientID?: string
  accountID?: string
  scopes?: string[]
  hostID?: string
}

type TokenResponse = {
  access_token: string
  refresh_token: string
  id_token?: string
  expires_in?: number
  scope?: string
}

type Pkce = {
  verifier: string
  challenge: string
}

let cachedTokens: OpenAIOAuthTokens | null | undefined

function getAuthFilePath(): string {
  return join(getClaudeConfigHomeDir(), 'openai-oauth.json')
}

function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
  return Buffer.from(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)).toString('base64url')
}

function randomValue(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
}

async function generatePKCE(): Promise<Pkce> {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const bytes = crypto.getRandomValues(new Uint8Array(43))
  const verifier = Array.from(bytes, b => chars[b % chars.length]!).join('')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64UrlEncode(digest) }
}

function extractAccountIDFromJwt(token?: string): string | undefined {
  if (!token) return undefined
  const part = token.split('.')[1]
  if (!part) return undefined
  try {
    const claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as {
      chatgpt_account_id?: string
      'https://api.openai.com/auth'?: { chatgpt_account_id?: string }
      organizations?: Array<{ id: string }>
    }
    return (
      claims.chatgpt_account_id ??
      claims['https://api.openai.com/auth']?.chatgpt_account_id ??
      claims.organizations?.[0]?.id
    )
  } catch {
    return undefined
  }
}

export function loadOpenAIOAuthTokens(): OpenAIOAuthTokens | null {
  if (cachedTokens !== undefined) {
    return cachedTokens
  }
  const path = getAuthFilePath()
  if (!existsSync(path)) {
    cachedTokens = null
    return null
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as OpenAIOAuthTokens
    if (!parsed?.accessToken || !parsed?.refreshToken) {
      cachedTokens = null
      return null
    }
    cachedTokens = parsed
    return parsed
  } catch {
    cachedTokens = null
    return null
  }
}

export function saveOpenAIOAuthTokens(tokens: OpenAIOAuthTokens): void {
  const dir = getClaudeConfigHomeDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(getAuthFilePath(), JSON.stringify(tokens, null, 2), { mode: 0o600 })
  cachedTokens = tokens
}

export function clearOpenAIOAuthTokens(): void {
  cachedTokens = null
  const path = getAuthFilePath()
  if (existsSync(path)) {
    unlinkSync(path)
  }
}

export function hasOpenAIAuth(): boolean {
  return getOpenAIAuthMethod() !== null
}

export function getOpenAIAuthMethod(): OpenAIAuthMethod | 'api-key' | null {
  if (process.env.OPENAI_API_KEY) return 'api-key'
  return loadOpenAIOAuthTokens()?.method ?? null
}

export function getOpenAIBaseURL(): string {
  if (process.env.OPENAI_BASE_URL) {
    return process.env.OPENAI_BASE_URL.replace(/\/+$/, '')
  }
  if (process.env.OPENAI_API_KEY) return OPENAI_API_BASE_URL
  const tokens = loadOpenAIOAuthTokens()
  if (tokens?.method === 'codex-browser') {
    return CODEX_API_BASE_URL
  }
  return OPENAI_API_BASE_URL
}

async function postForm<T>(url: string, params: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': `xCode/${MACRO.VERSION}`,
    },
    body: new URLSearchParams(params).toString(),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`OpenAI OAuth request failed (${response.status}): ${text.slice(0, 300)}`)
  }
  return response.json() as Promise<T>
}

export async function refreshOpenAIOAuthTokens(current: OpenAIOAuthTokens): Promise<OpenAIOAuthTokens> {
  if (current.method === 'chatgpt-token-sharing') {
    if (!current.clientID) {
      throw new Error('ChatGPT OAuth credentials are missing clientID; run `xcode auth login` again.')
    }
    const tokens = await postForm<TokenResponse>(TOKEN_SHARING_URL, {
      grant_type: 'refresh_token',
      client_id: current.clientID,
      refresh_token: current.refreshToken,
      resource: OPENAI_API_BASE_URL,
    })
    const updated: OpenAIOAuthTokens = {
      method: 'chatgpt-token-sharing',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || current.refreshToken,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      clientID: current.clientID,
      scopes: tokens.scope?.split(' ').filter(Boolean) ?? current.scopes,
      hostID: current.hostID,
    }
    saveOpenAIOAuthTokens(updated)
    return updated
  }

  const tokens = await postForm<TokenResponse>(CODEX_TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken,
    client_id: CODEX_CLIENT_ID,
  })
  const accountID =
    extractAccountIDFromJwt(tokens.id_token) ??
    extractAccountIDFromJwt(tokens.access_token) ??
    current.accountID
  const updated: OpenAIOAuthTokens = {
    method: 'codex-browser',
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || current.refreshToken,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    accountID,
  }
  saveOpenAIOAuthTokens(updated)
  return updated
}

export async function getValidOpenAICredentials(): Promise<{
  token: string
  baseURL: string
  accountID?: string
  method: OpenAIAuthMethod | 'api-key'
  isCustomBaseURL: boolean
}> {
  if (process.env.OPENAI_API_KEY) {
    return {
      token: process.env.OPENAI_API_KEY,
      baseURL: getOpenAIBaseURL(),
      method: 'api-key',
      isCustomBaseURL: Boolean(process.env.OPENAI_BASE_URL),
    }
  }

  let tokens = loadOpenAIOAuthTokens()
  if (!tokens) {
    throw new Error('Not authenticated with OpenAI/ChatGPT. Run `xcode auth login` or set OPENAI_API_KEY.')
  }

  if (tokens.expiresAt <= Date.now() + 60_000) {
    logForDebugging('[OpenAI OAuth] Refreshing expired access token')
    tokens = await refreshOpenAIOAuthTokens(tokens)
  }

  return {
    token: tokens.accessToken,
    baseURL: process.env.OPENAI_BASE_URL
      ? process.env.OPENAI_BASE_URL.replace(/\/+$/, '')
      : tokens.method === 'codex-browser'
        ? CODEX_API_BASE_URL
        : OPENAI_API_BASE_URL,
    accountID: tokens.accountID,
    method: tokens.method,
    isCustomBaseURL: Boolean(process.env.OPENAI_BASE_URL),
  }
}

function listenServer(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(err)
    server.once('error', onError)
    server.listen(port, host, () => {
      server.off('error', onError)
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to resolve OAuth callback port'))
        return
      }
      resolve(addr.port)
    })
  })
}

export async function loginWithOpenAIOAuth(options?: {
  method?: OpenAIAuthMethod
  onUrl?: (url: string) => void
  onSubmitCallback?: (submit: (callbackUrlOrCode: string) => void) => void
}): Promise<OpenAIOAuthTokens> {
  const method = options?.method ?? 'chatgpt-token-sharing'
  const pkce = await generatePKCE()
  const state = randomValue()
  const nonce = randomValue()
  const existing = loadOpenAIOAuthTokens()
  const hostID = existing?.hostID ?? `urn:uuid:${crypto.randomUUID()}`
  const savedClientID = method === 'chatgpt-token-sharing' ? existing?.clientID : undefined

  let resolveCallback!: (value: { code: string; clientID?: string }) => void
  let rejectCallback!: (err: Error) => void
  const callbackPromise = new Promise<{ code: string; clientID?: string }>((resolve, reject) => {
    resolveCallback = resolve
    rejectCallback = reject
  })

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/auth/callback') {
      res.writeHead(404).end('Not found')
      return
    }
    const err = url.searchParams.get('error_description') ?? url.searchParams.get('error')
    const code = url.searchParams.get('code')
    if (err) {
      res.writeHead(400, { 'Content-Type': 'text/html' }).end(`<h3>ChatGPT Sign-In Error</h3><p>${err}</p>`)
      rejectCallback(new Error(err))
      return
    }
    if (!code || url.searchParams.get('state') !== state) {
      const msg = code ? 'Invalid OAuth state' : 'Missing authorization code'
      res.writeHead(400, { 'Content-Type': 'text/html' }).end(`<h3>ChatGPT Sign-In Error</h3><p>${msg}</p>`)
      rejectCallback(new Error(msg))
      return
    }
    res
      .writeHead(200, { 'Content-Type': 'text/html' })
      .end('<h3>Authentication successful!</h3><p>You can close this window and return to the terminal.</p>')
    resolveCallback({
      code,
      clientID: url.searchParams.get('client_id') ?? undefined,
    })
  })

  try {
    let port: number
    if (method === 'chatgpt-token-sharing') {
      port = await listenServer(server, 0, '127.0.0.1')
    } else {
      try {
        port = await listenServer(server, 1455, 'localhost')
      } catch {
        port = await listenServer(server, 1457, 'localhost')
      }
    }

    const redirectUri =
      method === 'chatgpt-token-sharing'
        ? `http://127.0.0.1:${port}/auth/callback`
        : `http://localhost:${port}/auth/callback`

    const authUrl =
      method === 'chatgpt-token-sharing'
        ? `${ISSUER}/api/accounts/authorize?${new URLSearchParams({
            client_id: savedClientID ?? REGISTRATION_CLIENT_ID,
            ...(savedClientID ? {} : { agent_name_hint: 'xCode' }),
            ext_agent_host_id: hostID,
            response_type: 'code',
            redirect_uri: redirectUri,
            scope: `openid profile email offline_access resource.invoke ${TOKEN_SHARING_SCOPE}`,
            resource: OPENAI_API_BASE_URL,
            state,
            nonce,
            code_challenge_method: 'S256',
            code_challenge: pkce.challenge,
          })}`
        : `${ISSUER}/oauth/authorize?${new URLSearchParams({
            response_type: 'code',
            client_id: CODEX_CLIENT_ID,
            redirect_uri: redirectUri,
            scope: 'openid profile email offline_access',
            code_challenge: pkce.challenge,
            code_challenge_method: 'S256',
            id_token_add_organizations: 'true',
            codex_cli_simplified_flow: 'true',
            state,
            originator: 'opencode',
          })}`

    options?.onUrl?.(authUrl)
    options?.onSubmitCallback?.((rawInput: string) => {
      const trimmed = rawInput.trim()
      if (!trimmed) return
      try {
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          const parsed = new URL(trimmed)
          const err =
            parsed.searchParams.get('error_description') ??
            parsed.searchParams.get('error')
          if (err) {
            rejectCallback(new Error(err))
            return
          }
          const code = parsed.searchParams.get('code')
          const returnedState = parsed.searchParams.get('state')
          if (!code || (returnedState && returnedState !== state)) {
            rejectCallback(
              new Error(code ? 'Invalid OAuth state' : 'Missing authorization code'),
            )
            return
          }
          resolveCallback({
            code,
            clientID: parsed.searchParams.get('client_id') ?? undefined,
          })
          return
        }
        const params = new URLSearchParams(trimmed.startsWith('?') ? trimmed.slice(1) : trimmed)
        const code = params.get('code') ?? trimmed
        const returnedState = params.get('state')
        if (returnedState && returnedState !== state) {
          rejectCallback(new Error('Invalid OAuth state'))
          return
        }
        resolveCallback({
          code,
          clientID: params.get('client_id') ?? undefined,
        })
      } catch (err) {
        rejectCallback(err instanceof Error ? err : new Error(String(err)))
      }
    })
    await openBrowser(authUrl).catch(() => {})

    const result = await callbackPromise

    if (method === 'chatgpt-token-sharing') {
      const clientID = savedClientID ?? result.clientID
      if (!clientID) {
        throw new Error('ChatGPT sign-in did not return a client_id.')
      }
      const tokens = await postForm<TokenResponse>(TOKEN_SHARING_URL, {
        grant_type: 'authorization_code',
        client_id: clientID,
        code: result.code,
        code_verifier: pkce.verifier,
        redirect_uri: redirectUri,
        resource: OPENAI_API_BASE_URL,
      })
      if (!tokens.scope?.split(' ').includes(TOKEN_SHARING_SCOPE)) {
        throw new Error('ChatGPT sign-in finished without token sharing permission. Sign in again and allow token sharing.')
      }
      const saved: OpenAIOAuthTokens = {
        method: 'chatgpt-token-sharing',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
        clientID,
        scopes: tokens.scope.split(' ').filter(Boolean),
        hostID,
      }
      saveOpenAIOAuthTokens(saved)
      return saved
    }

    const tokens = await postForm<TokenResponse>(CODEX_TOKEN_URL, {
      grant_type: 'authorization_code',
      code: result.code,
      redirect_uri: redirectUri,
      client_id: CODEX_CLIENT_ID,
      code_verifier: pkce.verifier,
    })
    const accountID =
      extractAccountIDFromJwt(tokens.id_token) ?? extractAccountIDFromJwt(tokens.access_token)
    const saved: OpenAIOAuthTokens = {
      method: 'codex-browser',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      accountID,
    }
    saveOpenAIOAuthTokens(saved)
    return saved
  } finally {
    server.close()
  }
}

export async function loginWithOpenAIDeviceCode(options?: {
  onCode?: (info: { verificationUri: string; userCode: string; expiresAt?: string }) => void
  signal?: AbortSignal
}): Promise<OpenAIOAuthTokens> {
  const usercodeRes = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
    signal: options?.signal,
  })
  if (!usercodeRes.ok) {
    const body = await usercodeRes.text().catch(() => '')
    throw new Error(`Device code request failed (${usercodeRes.status}): ${body || usercodeRes.statusText}`)
  }

  const deviceData = (await usercodeRes.json()) as {
    device_auth_id: string
    user_code: string
    interval?: string | number
    expires_at?: string
  }

  const verificationUri = `${ISSUER}/codex/device`
  options?.onCode?.({
    verificationUri,
    userCode: deviceData.user_code,
    expiresAt: deviceData.expires_at,
  })
  await openBrowser(verificationUri).catch(() => {})

  const pollIntervalMs = Math.max(3, Number(deviceData.interval ?? 5)) * 1000
  const expiresAtMs = deviceData.expires_at
    ? Date.parse(deviceData.expires_at)
    : Date.now() + 15 * 60 * 1000

  while (Date.now() < expiresAtMs) {
    if (options?.signal?.aborted) {
      throw new Error('Device login cancelled')
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    if (options?.signal?.aborted) {
      throw new Error('Device login cancelled')
    }

    const pollRes = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_auth_id: deviceData.device_auth_id,
        user_code: deviceData.user_code,
      }),
      signal: options?.signal,
    })

    if (pollRes.status === 403 || pollRes.status === 404) {
      continue
    }

    if (!pollRes.ok) {
      const body = await pollRes.text().catch(() => '')
      throw new Error(`Device auth polling failed (${pollRes.status}): ${body || pollRes.statusText}`)
    }

    const approved = (await pollRes.json()) as {
      authorization_code: string
      code_verifier: string
    }

    const tokens = await postForm<TokenResponse>(CODEX_TOKEN_URL, {
      grant_type: 'authorization_code',
      code: approved.authorization_code,
      redirect_uri: `${ISSUER}/deviceauth/callback`,
      client_id: CODEX_CLIENT_ID,
      code_verifier: approved.code_verifier,
    })

    const accountID =
      extractAccountIDFromJwt(tokens.id_token) ?? extractAccountIDFromJwt(tokens.access_token)
    const saved: OpenAIOAuthTokens = {
      method: 'codex-browser',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      accountID,
    }
    saveOpenAIOAuthTokens(saved)
    return saved
  }

  throw new Error('Device authorization code expired. Please try again.')
}
