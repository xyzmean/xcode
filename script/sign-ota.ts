import { createPrivateKey, sign, verify, type KeyLike } from 'node:crypto'
import { join } from 'node:path'
import { otaPublicKey } from '../src/utils/nativeInstaller/otaPublicKey.js'

export function signOtaManifest(manifest: Uint8Array, privateKey: KeyLike, publicKey: KeyLike = otaPublicKey): Buffer {
  const signature = sign(null, manifest, privateKey)
  if (signature.length !== 64 || !verify(null, manifest, publicKey, signature)) {
    throw new Error('Signing key does not match the updater’s Ed25519 public key')
  }
  return signature
}

if (import.meta.main) {
  const directory = process.argv[2]
  const pem = process.env.XCODE_OTA_SIGNING_KEY
  if (!directory || !pem) throw new Error('Supply the release directory and set XCODE_OTA_SIGNING_KEY')

  const privateKey = createPrivateKey(pem)
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('XCODE_OTA_SIGNING_KEY must be Ed25519')
  const manifest = await Bun.file(join(directory, 'manifest.json')).bytes()
  const signature = signOtaManifest(manifest, privateKey)
  await Bun.write(join(directory, 'manifest.json.sig'), signature)
}
