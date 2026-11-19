#!/usr/bin/env bun

import { createHash } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import type { BunPlugin } from 'bun'
import pkg from '../package.json'

const rootDir = path.resolve(import.meta.dirname, '..')
process.chdir(rootDir)

const allTargets = [
  { name: 'linux-x64', target: 'bun-linux-x64', ext: '' },
  { name: 'linux-arm64', target: 'bun-linux-arm64', ext: '' },
  { name: 'darwin-arm64', target: 'bun-darwin-arm64', ext: '' },
  { name: 'darwin-x64', target: 'bun-darwin-x64', ext: '' },
  { name: 'windows-x64', target: 'bun-windows-x64', ext: '.exe' },
] as const

const requested = process.argv.find(a => a.startsWith('--target='))?.slice('--target='.length)
const buildAll = process.argv.includes('--all')
const hostTarget = `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`
const targets = buildAll
  ? allTargets
  : allTargets.filter(t => t.name === (requested ?? hostTarget))

if (targets.length === 0) {
  console.error(`Unknown target: ${requested ?? hostTarget}`)
  process.exit(1)
}

const outdir = path.resolve(rootDir, 'dist')
if (buildAll) await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

// Stub optional/internal modules omitted from the source snapshot.
const missingModulesPlugin: BunPlugin = {
  name: 'xcode-missing-stubs',
  setup(build) {
    build.onResolve({ filter: /ultraplan[/\\]prompt\.txt$/ }, args => ({
      path: args.path,
      namespace: 'xcode-stub-txt',
    }))
    build.onLoad({ filter: /.*/, namespace: 'xcode-stub-txt' }, () => ({
      contents: '',
      loader: 'text',
    }))

    build.onResolve({ filter: /^modifiers-napi$/ }, args => ({
      path: args.path,
      namespace: 'xcode-stub-modifiers',
    }))
    build.onLoad({ filter: /.*/, namespace: 'xcode-stub-modifiers' }, () => ({
      contents: 'export function isModifierPressed() { return false }',
      loader: 'js',
    }))

    build.onResolve(
      {
        filter:
          /^sharp$|^\.\/devtools\.js$|^@opentelemetry\/exporter-|^@aws-sdk\/client-(bedrock|sts)$|^@anthropic-ai\/(bedrock|foundry|vertex)-sdk$|^@azure\/identity$|SnapshotUpdateDialog(\.js)?$|AssistantSessionChooser(\.js)?$|commands[/\\]assistant[/\\]assistant(\.js)?$/,
      },
      args => ({
        path: args.path,
        namespace: 'xcode-stub-empty',
      }),
    )
    build.onLoad({ filter: /.*/, namespace: 'xcode-stub-empty' }, () => ({
      contents: 'export default {}',
      loader: 'js',
    }))
  },
}

const version = pkg.version
const buildTime = new Date().toISOString()
const buildOptions = {
  entrypoints: ['./src/entrypoints/cli.tsx'],
  tsconfig: './tsconfig.json',
  plugins: [missingModulesPlugin],
  external: ['node-gyp'],
  features: [
    'PROMPT_CACHE_BREAK_DETECTION',
    'AGENT_TRIGGERS',
    'ULTRATHINK',
    'EXTRACT_MEMORIES',
    'TEAMMEM',
    'NEW_INIT',
    'FILE_PERSISTENCE',
    'CACHED_MICROCOMPACT',
    'TOKEN_BUDGET',
    'SHOT_STATS',
    'CONTEXT_COLLAPSE',
    'REACTIVE_COMPACT',
    'AUTO_THEME',
  ],
  define: {
    'MACRO.VERSION': JSON.stringify(version),
    'MACRO.XCODE_STANDALONE': JSON.stringify(!process.argv.includes('--bundle')),
    'MACRO.BUILD_TIME': JSON.stringify(buildTime),
    'MACRO.PACKAGE_URL': JSON.stringify('@xyzmean/xcode'),
    'MACRO.NATIVE_PACKAGE_URL': JSON.stringify(''),
    'MACRO.FEEDBACK_CHANNEL': JSON.stringify(''),
    'MACRO.ISSUES_EXPLAINER': JSON.stringify('report at https://github.com/xyzmean/xcode/issues'),
    'MACRO.VERSION_CHANGELOG': JSON.stringify(''),
    'process.env.USER_TYPE': JSON.stringify('external'),
  },
}

if (process.argv.includes('--bundle')) {
  await Bun.build({ ...buildOptions, target: 'bun', outdir })
  process.exit(0)
}

const manifest: { version: string; buildTime: string; targets: Record<string, { file: string; sha256: string; size: number }> } = {
  version,
  buildTime,
  targets: {},
}

for (const item of targets) {
  const targetDir = path.join(outdir, item.name)
  await mkdir(targetDir, { recursive: true })
  const outfile = path.join(targetDir, `xcode${item.ext}`)
  console.log(`Building ${item.name} -> ${path.relative(rootDir, outfile)}`)

  const result = await Bun.build({
    ...buildOptions,
    minify: true,
    sourcemap: 'none',
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      target: item.target as Bun.Build.CompileTarget,
      outfile,
    },
  })

  if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }

  const bytes = await Bun.file(outfile).bytes()
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  manifest.targets[item.name] = {
    file: `${item.name}/xcode${item.ext}`,
    sha256,
    size: bytes.byteLength,
  }
  console.log(`Built ${item.name} (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB) sha256=${sha256.slice(0, 12)}...`)
}

await Bun.write(path.join(outdir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
