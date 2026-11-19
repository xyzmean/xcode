import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { sleep } from '../../utils/sleep.js'
import { jsonStringify } from '../../utils/slowOperations.js'

const WAIT_FOR_MCP_SERVERS_TOOL_NAME = 'WaitForMcpServers'
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_TIMEOUT_MS = 60_000

const DESCRIPTION = `Wait for pending MCP servers to finish connecting before listing or calling their tools.`

const PROMPT = `Wait for MCP servers that are currently in the "pending" connection state to settle (connected or failed).

Parameters:
- servers (optional): Specific server names to wait for. If omitted, waits for all pending MCP servers.
- timeout_ms (optional): Maximum time to wait in milliseconds (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).`

export const inputSchema = lazySchema(() =>
  z.object({
    servers: z
      .array(z.string())
      .optional()
      .describe('Optional list of MCP server names to wait for.'),
    timeout_ms: z
      .number()
      .int()
      .min(100)
      .max(MAX_TIMEOUT_MS)
      .optional()
      .default(DEFAULT_TIMEOUT_MS)
      .describe(
        `Maximum wait time in milliseconds (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).`,
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() =>
  z.object({
    timedOut: z.boolean(),
    servers: z.array(
      z.object({
        name: z.string(),
        status: z.string(),
      }),
    ),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const WaitForMcpServersTool = buildTool({
  name: WAIT_FOR_MCP_SERVERS_TOOL_NAME,
  searchHint: 'wait for pending MCP servers to finish connecting',
  shouldDefer: true,
  maxResultSizeChars: 20_000,
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.servers?.join(', ') ?? ''
  },
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'WaitForMcpServers'
  },
  renderToolUseMessage(input) {
    return input.servers?.length
      ? `Waiting for MCP servers: ${input.servers.join(', ')}`
      : 'Waiting for pending MCP servers'
  },
  async call(input, { abortController, getAppState, options: { mcpClients } }) {
    const timeoutMs = Math.min(input.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
    const targetSet = input.servers ? new Set(input.servers) : null
    const deadline = Date.now() + timeoutMs

    const getClients = (): Array<{ name: string; type: string }> => {
      const clients = (getAppState().mcp.clients ?? mcpClients) as Array<{
        name: string
        type: string
      }>
      return targetSet ? clients.filter(c => targetSet.has(c.name)) : clients
    }

    let timedOut = false
    while (true) {
      const relevant = getClients()
      const hasPending = relevant.some(c => c.type === 'pending')
      if (!hasPending) break
      if (Date.now() >= deadline || abortController.signal.aborted) {
        timedOut = true
        break
      }
      await sleep(200)
    }

    const finalClients = getClients()
    return {
      data: {
        timedOut,
        servers: finalClients.map(c => ({
          name: c.name,
          status: c.type,
        })),
      },
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
