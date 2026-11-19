import { z } from 'zod/v4'
import { fetchToolsForClient } from '../../services/mcp/client.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'

const REFRESH_MCP_TOOLS_TOOL_NAME = 'RefreshMcpTools'

const DESCRIPTION = `Re-query the tool lists of connected MCP servers and update the available tools.

Use when:
- A tool you expect an MCP server to provide is absent from your available tools.
- A server's tools look stale after its connection recovered.

Usage:
- Refresh all connected servers: \`RefreshMcpTools\` with no arguments
- Refresh one server: \`RefreshMcpTools({ server: "myserver" })\``

const PROMPT = `Re-query the tool lists of connected MCP servers and update the available tools.

Returns one entry per server: the server name, refresh status, current tool count, and which tool names were added or removed relative to what was previously available. Servers that are not currently connected are reported as not_connected (this tool never dials or re-dials connections — it only re-reads the tool list over the existing connection).

Parameters:
- server (optional): The name of a specific MCP server to refresh. If not provided, all connected servers are refreshed.`

export const inputSchema = lazySchema(() =>
  z.object({
    server: z
      .string()
      .optional()
      .describe(
        'Optional server name: refresh only this server. Omit to refresh all connected servers.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() =>
  z.array(
    z.object({
      server: z.string().describe('Server name'),
      status: z
        .enum(['refreshed', 'error', 'not_connected'])
        .describe(
          'refreshed: tool list re-queried and applied. error: the re-query failed and the previous tool set was kept. not_connected: the server has no live connection to query.',
        ),
      toolCount: z
        .number()
        .optional()
        .describe('Number of tools now available from this server'),
      added: z
        .array(z.string())
        .optional()
        .describe('Tool names this refresh added'),
      removed: z
        .array(z.string())
        .optional()
        .describe('Tool names this refresh removed'),
      error: z
        .string()
        .optional()
        .describe('Why the refresh failed or the server was unavailable'),
    }),
  ),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const RefreshMcpToolsTool = buildTool({
  name: REFRESH_MCP_TOOLS_TOOL_NAME,
  searchHint:
    'refresh or re-sync tool lists from connected MCP servers, recover missing device or server tools',
  shouldDefer: true,
  maxResultSizeChars: 50_000,
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.server ?? ''
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
    return 'RefreshMcpTools'
  },
  renderToolUseMessage(input) {
    return input.server
      ? `Refresh tools from MCP server "${input.server}"`
      : 'Refresh tools from all connected MCP servers'
  },
  async call(input, { options: { mcpClients }, setAppState }) {
    const { server: targetServer } = input
    const clientsToProcess = targetServer
      ? mcpClients.filter(client => client.name === targetServer)
      : mcpClients

    if (targetServer && clientsToProcess.length === 0) {
      throw new Error(
        `Server "${targetServer}" not found. Available servers: ${mcpClients.map(c => c.name).join(', ')}`,
      )
    }

    const prefixFor = (name: string) => `mcp__${name}__`

    const results: Output = await Promise.all(
      clientsToProcess.map(async client => {
        if (client.type !== 'connected') {
          return {
            server: client.name,
            status: 'not_connected' as const,
            error: `Server "${client.name}" is not connected (state: ${client.type})`,
          }
        }
        try {
          const prevPromise = fetchToolsForClient.cache.get(client.name)
          const prevTools = prevPromise ? await prevPromise.catch(() => []) : []
          const prevNames = new Set(prevTools.map(t => t.name))

          fetchToolsForClient.cache.delete(client.name)
          const nextTools = await fetchToolsForClient(client)
          const nextNames = new Set(nextTools.map(t => t.name))

          const added = [...nextNames].filter(n => !prevNames.has(n))
          const removed = [...prevNames].filter(n => !nextNames.has(n))

          if (setAppState) {
            const prefix = prefixFor(client.name)
            setAppState(prev => ({
              ...prev,
              mcp: {
                ...prev.mcp,
                tools: [
                  ...prev.mcp.tools.filter((t: { name: string }) => !t.name.startsWith(prefix)),
                  ...nextTools,
                ],
              },
            }))
          }

          return {
            server: client.name,
            status: 'refreshed' as const,
            toolCount: nextTools.length,
            ...(added.length > 0 ? { added } : {}),
            ...(removed.length > 0 ? { removed } : {}),
          }
        } catch (err) {
          return {
            server: client.name,
            status: 'error' as const,
            error: err instanceof Error ? err.message : String(err),
          }
        }
      }),
    )

    return { data: results }
  },
  mapToolResultToToolResultBlockParam(data, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify(data),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
