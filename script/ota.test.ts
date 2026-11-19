import { expect, test } from 'bun:test'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { updateNativeBinary } from '../src/utils/nativeInstaller/ota.js'

test('OTA verifies signed metadata and payload before replacing the installed executable', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const dir = await mkdtemp(join(tmpdir(), 'xcode-ota-'))
  const executable = join(dir, 'test-xcode')
  const payload = 'new binary'
  const manifest = Buffer.from(JSON.stringify({ version: '0.0.2', targets: {
    'linux-x64': { size: payload.length, sha256: createHash('sha256').update(payload).digest('hex') },
  } }))
  const signature = sign(null, manifest, privateKey)
  let corruptSignature = true
  let artifact = 'bad binary'
  let downloads = 0
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
    switch (new URL(req.url).pathname) {
      case '/manifest.json': return new Response(manifest)
      case '/manifest.json.sig': return new Response(corruptSignature ? Buffer.alloc(64) : signature)
      case '/xcode-linux-x64': downloads++; return new Response(artifact)
      default: return new Response(null, { status: 404 })
    }
  } })
  const update = (currentVersion = '0.0.1') => updateNativeBinary({
    currentVersion, executable, target: 'linux-x64', downloadRoot: server.url.href, signingKey: publicKey,
  })
  try {
    await writeFile(executable, 'old binary')
    await expect(update()).rejects.toThrow('signature is invalid')
    expect(downloads).toBe(0)
    corruptSignature = false
    await expect(update()).rejects.toThrow('SHA-256')
    expect(await readFile(executable, 'utf8')).toBe('old binary')
    artifact = payload
    await expect(update()).resolves.toEqual({ status: 'installed', version: '0.0.2' })
    expect(await readFile(executable, 'utf8')).toBe(payload)
    await expect(update()).resolves.toEqual({ status: 'already-installed', version: '0.0.2' })
    await expect(update('0.0.3')).resolves.toEqual({ status: 'current', version: '0.0.3' })
    expect(downloads).toBe(2)
  } finally {
    await server.stop(true)
    await rm(dir, { recursive: true, force: true })
  }
})
