import { execFile } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'

const execFileAsync = promisify(execFile)
const WORKFLOW_TOOL_NAME = 'Workflow'

const DESCRIPTION = `Execute a local TypeScript/JavaScript workflow script using Bun in the current working directory.`

export const inputSchema = lazySchema(() =>
  z.object({
    script: z
      .string()
      .describe(
        'Self-contained TypeScript or JavaScript workflow script to execute.',
      ),
    timeout_ms: z
      .number()
      .int()
      .min(1000)
      .max(300_000)
      .optional()
      .default(60_000)
      .describe('Execution timeout in milliseconds (default 60000, max 300000).'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() =>
  z.object({
    exitCode: z.number(),
    stdout: z.string(),
    stderr: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const WorkflowTool = buildTool({
  name: WORKFLOW_TOOL_NAME,
  searchHint: 'run a local TypeScript or JavaScript workflow script',
  shouldDefer: true,
  maxResultSizeChars: 50_000,
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    return input.script.slice(0, 200)
  },
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return DESCRIPTION
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'Workflow'
  },
  renderToolUseMessage() {
    return 'Running local workflow script'
  },
  async call(input, { abortController }) {
    const dir = mkdtempSync(join(tmpdir(), 'xcode-workflow-'))
    const scriptPath = join(dir, 'workflow.ts')
    writeFileSync(scriptPath, input.script, 'utf8')

    try {
      const runtime = process.execPath
      const { stdout, stderr } = await execFileAsync(runtime, ['run', scriptPath], {
        cwd: getCwd(),
        timeout: input.timeout_ms ?? 60_000,
        signal: abortController.signal,
        maxBuffer: 4 * 1024 * 1024,
      })
      return {
        data: {
          exitCode: 0,
          stdout,
          stderr,
        },
      }
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string; message?: string }
      return {
        data: {
          exitCode: typeof e.code === 'number' ? e.code : 1,
          stdout: e.stdout ?? '',
          stderr: e.stderr ?? e.message ?? String(err),
        },
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
  mapToolResultToToolResultBlockParam(data, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify(data),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
