import axios from 'axios'

export type SearchHit = {
  title: string
  url: string
}

export type SearchHitWithSnippet = SearchHit & { snippet?: string }

const SEARCH_TIMEOUT_MS = 20_000
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_HITS = 10

const SEARCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

// DuckDuckGo wraps result links as //duckduckgo.com/l/?uddg=<encoded-url>&rut=...
function unwrapDuckDuckGoUrl(href: string): string | null {
  const decoded = decodeEntities(href)
  try {
    const url = new URL(decoded, 'https://duckduckgo.com')
    if (url.pathname === '/l/') {
      const target = url.searchParams.get('uddg')
      return target ? decodeURIComponent(target) : null
    }
    if (url.hostname.endsWith('duckduckgo.com')) return null
    return url.toString()
  } catch {
    return null
  }
}

export function parseDuckDuckGoResults(html: string): SearchHitWithSnippet[] {
  const hits: SearchHitWithSnippet[] = []
  const seen = new Set<string>()
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  for (const match of html.matchAll(linkRe)) {
    const url = unwrapDuckDuckGoUrl(match[1]!)
    if (!url || seen.has(url)) continue
    const title = stripTags(match[2]!)
    if (!title) continue
    seen.add(url)
    // Snippet follows the title link within the same result block
    const after = html.slice(match.index! + match[0].length, match.index! + match[0].length + 2000)
    const snippetMatch = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(after)
    const snippet = snippetMatch ? stripTags(snippetMatch[1]!) : undefined
    hits.push({ title, url, ...(snippet ? { snippet } : {}) })
    if (hits.length >= MAX_HITS) break
  }
  return hits
}

export function parseBingResults(html: string): SearchHitWithSnippet[] {
  const hits: SearchHitWithSnippet[] = []
  const seen = new Set<string>()
  const itemRe = /<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  for (const match of html.matchAll(itemRe)) {
    const url = decodeEntities(match[1]!)
    if (!/^https?:\/\//.test(url) || seen.has(url)) continue
    const title = stripTags(match[2]!)
    if (!title) continue
    seen.add(url)
    const after = html.slice(match.index! + match[0].length, match.index! + match[0].length + 3000)
    const snippetMatch = /<p[^>]*>([\s\S]*?)<\/p>/.exec(after)
    const snippet = snippetMatch ? stripTags(snippetMatch[1]!) : undefined
    hits.push({ title, url, ...(snippet ? { snippet } : {}) })
    if (hits.length >= MAX_HITS) break
  }
  return hits
}

function matchesDomain(url: string, domain: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    const d = domain.toLowerCase().replace(/^www\./, '')
    return host === d || host.endsWith(`.${d}`)
  } catch {
    return false
  }
}

export function filterHitsByDomain(
  hits: SearchHitWithSnippet[],
  allowed?: string[],
  blocked?: string[],
): SearchHitWithSnippet[] {
  return hits.filter(hit => {
    if (allowed?.length && !allowed.some(d => matchesDomain(hit.url, d))) return false
    if (blocked?.length && blocked.some(d => matchesDomain(hit.url, d))) return false
    return true
  })
}

async function fetchSearchPage(url: string, signal: AbortSignal): Promise<string> {
  const res = await axios.get(url, {
    signal,
    timeout: SEARCH_TIMEOUT_MS,
    responseType: 'text',
    maxContentLength: MAX_RESPONSE_BYTES,
    maxRedirects: 5,
    headers: SEARCH_HEADERS,
    transformResponse: [(data: unknown) => data],
  })
  return String(res.data)
}

export async function searchDuckDuckGo(query: string, signal: AbortSignal): Promise<SearchHitWithSnippet[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  return parseDuckDuckGoResults(await fetchSearchPage(url, signal))
}

export async function searchBing(query: string, signal: AbortSignal): Promise<SearchHitWithSnippet[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${MAX_HITS}`
  return parseBingResults(await fetchSearchPage(url, signal))
}

/** Try DuckDuckGo first, fall back to Bing when it returns nothing usable. */
export async function performWebSearch(query: string, signal: AbortSignal): Promise<SearchHitWithSnippet[]> {
  const errors: string[] = []
  for (const engine of [searchDuckDuckGo, searchBing]) {
    if (signal.aborted) break
    try {
      const hits = await engine(query, signal)
      if (hits.length > 0) return hits
      errors.push(`${engine.name}: no results`)
    } catch (err) {
      if (signal.aborted) throw err
      errors.push(`${engine.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw new Error(`Web search failed for "${query}" (${errors.join('; ')})`)
}
