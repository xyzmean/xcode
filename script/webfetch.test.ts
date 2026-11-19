import axios, { AxiosError, type AxiosResponse } from 'axios'
import { expect, test } from 'bun:test'
import { clearWebFetchCache, getURLMarkdownContent } from '../src/tools/WebFetchTool/utils.js'

test('WebFetch requests only the approved URL and permitted redirects', async () => {
  const urls: string[] = []
  const adapter = axios.defaults.adapter
  axios.defaults.adapter = async config => {
    const url = config.url!
    urls.push(url)
    const response: AxiosResponse = {
      config,
      data: Buffer.from('content'),
      headers: { 'content-type': 'text/plain' },
      status: 200,
      statusText: 'OK',
    }
    switch (url) {
      case 'https://example.com/start':
        response.status = 302
        response.headers.location = 'https://www.example.com/final'
        break
      case 'https://example.com/redirect':
        response.status = 302
        response.headers.location = 'https://other.example.com/'
        break
      case 'https://example.com/blocked':
        response.status = 403
        response.headers['x-proxy-error'] = 'blocked-by-allowlist'
        break
      case 'https://www.example.com/final':
        return response
      default:
        throw new Error(`Unexpected fetch: ${url}`)
    }
    throw new AxiosError('Request failed', undefined, config, undefined, response)
  }

  try {
    const controller = new AbortController()
    await expect(getURLMarkdownContent('https://user:pw@example.com/', controller))
      .rejects.toThrow('Invalid URL')
    await expect(getURLMarkdownContent('http://example.com/start', controller))
      .resolves.toMatchObject({ content: 'content' })
    await expect(getURLMarkdownContent('https://example.com/redirect', controller))
      .resolves.toMatchObject({ type: 'redirect', redirectUrl: 'https://other.example.com/' })
    await expect(getURLMarkdownContent('https://example.com/blocked', controller))
      .rejects.toThrow('EGRESS_BLOCKED')
    expect(urls).toEqual([
      'https://example.com/start',
      'https://www.example.com/final',
      'https://example.com/redirect',
      'https://example.com/blocked',
    ])
  } finally {
    axios.defaults.adapter = adapter
    clearWebFetchCache()
  }
})
