import { createHash, type KeyLike, verify } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdtemp, realpath, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import type { ReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'
import { gt, valid } from 'semver'
import { z } from 'zod/v4'
import { lock } from '../lockfile.js'

export const OTA_DOWNLOAD = 'http://10.8.0.1/xcode/releases/latest/download/'
const publicKey = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAwxYzV80NXAEtKNV1brMMpOVOOiCTw+wt7u816dfm8O8=
-----END PUBLIC KEY-----`

const manifestSchema = z.object({
  version: z.string().refine(version => valid(version) === version),
  targets: z.record(z.string(), z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().positive().max(512 * 1024 * 1024),
  })),
})

async function request(url: URL, signal: AbortSignal): Promise<Response> {
  const response = await fetch(url, { signal, redirect: 'error' })
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new Error(`OTA request failed (HTTP ${response.status})`)
  }
  return response
}

async function readBounded(response: Response, limit: number): Promise<Buffer> {
  const reader = response.body!.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return Buffer.concat(chunks, size)
      size += value.byteLength
      if (size > limit) throw new Error('OTA metadata exceeds size limit')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }
}

export const nativeTarget = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`
export function otaArtifactName(target: string): string {
  return `xcode-${target}${target === 'windows-x64' ? '.exe' : ''}`
}

export async function updateNativeBinary({
  currentVersion,
  executable,
  target = nativeTarget,
  downloadRoot = OTA_DOWNLOAD,
  signingKey = publicKey,
  onInstalling,
}: {
  currentVersion: string
  executable: string
  target?: string
  downloadRoot?: string
  signingKey?: KeyLike
  onInstalling?: () => void
}): Promise<{ version: string; status: 'current' | 'installed' | 'already-installed' }> {
  const destination = await realpath(executable)
  const original = await lstat(destination)
  if (!original.isFile()) throw new Error('xCode executable is not a regular file')
  const metadataSignal = AbortSignal.timeout(5000)
  const [manifestBytes, signature] = await Promise.all([
    request(new URL('manifest.json', downloadRoot), metadataSignal).then(response => readBounded(response, 32_768)),
    request(new URL('manifest.json.sig', downloadRoot), metadataSignal).then(response => readBounded(response, 64)),
  ])
  if (signature.length !== 64 || !verify(null, manifestBytes, signingKey, signature)) {
    throw new Error('OTA manifest signature is invalid')
  }
  const { version, targets } = manifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')))
  if (!gt(version, currentVersion)) return { version: currentVersion, status: 'current' }
  if (!/^(linux-(x64|arm64)|darwin-(x64|arm64)|windows-x64)$/.test(target)) {
    throw new Error(`Unsupported OTA platform: ${target}`)
  }
  const artifact = targets[target]
  if (!artifact) throw new Error(`OTA release ${version} has no binary for ${target}`)

  const release = await lock(destination, { lockfilePath: `${destination}.ota.lock` })
  try {
    const current = await lstat(destination)
    if (!current.isFile() || current.dev !== original.dev || current.ino !== original.ino) {
      throw new Error('xCode executable changed during the update check; retry after restarting')
    }
    if (current.size === artifact.size) {
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(destination)) hash.update(chunk)
      if (hash.digest('hex') === artifact.sha256) return { version, status: 'already-installed' }
    }

    onInstalling?.()
    const stage = await mkdtemp(join(dirname(destination), '.xcode-ota-'))
    try {
      const staged = join(stage, 'xcode')
      const signal = AbortSignal.timeout(180_000)
      const response = await request(new URL(otaArtifactName(target), downloadRoot), signal)
      const hash = createHash('sha256')
      let size = 0
      await pipeline(
        Readable.fromWeb(response.body! as ReadableStream<Uint8Array>),
        new Transform({ transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length
          if (size > artifact.size) return callback(new Error('OTA binary exceeds the signed size'))
          hash.update(chunk)
          callback(null, chunk)
        } }),
        createWriteStream(staged, { flags: 'wx', mode: 0o755 }),
        { signal },
      )
      if (size !== artifact.size || hash.digest('hex') !== artifact.sha256) {
        throw new Error('OTA binary does not match the signed size or SHA-256')
      }
      const beforeReplace = await lstat(destination)
      if (beforeReplace.dev !== current.dev || beforeReplace.ino !== current.ino || beforeReplace.mtimeMs !== current.mtimeMs) {
        throw new Error('xCode executable changed during download; retry after restarting')
      }
      try {
        await rename(staged, destination)
      } catch (error) {
        if (process.platform === 'win32') {
          throw new Error('Close all xCode processes and install the new build from the WireGuard mirror.', { cause: error })
        }
        throw error
      }
      return { version, status: 'installed' }
    } finally {
      await rm(stage, { recursive: true, force: true })
    }
  } finally {
    await release()
  }
}

export async function updateRunningNative(onInstalling?: () => void) {
  const executable = process.execPath
  if (process.platform === 'linux') {
    const [running, installed] = await Promise.all([stat('/proc/self/exe'), stat(executable)])
    if (running.dev !== installed.dev || running.ino !== installed.ino) {
      throw new Error('The installed xCode has already changed. Restart xCode before updating.')
    }
  }
  return updateNativeBinary({ currentVersion: MACRO.VERSION, executable, onInstalling })
}
