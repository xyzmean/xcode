import { ListResourcesResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'

const READ_MCP_RESOURCE_DIR_TOOL_NAME = 'ReadMcpResourceDirTool'

const DESCRIPTION = `List the direct children of a directory resource on an MCP server.
- server: The name of the MCP server to read from
- uri: The URI of the directory resource

Only usable against a server that has declared support for directory listing. The listing is not recursive.`

const PROMPT = `List the direct children of a directory resource on an MCP server (\`resources/directory/read\`).

Parameters:
- server (required): The name of the MCP server to read from
- uri (required): The URI of the directory resource

The listing is not recursive. Each entry carries its own \`uri\`; subdirectories appear with mimeType "inode/directory" — call this tool again on a subdirectory's \`uri\` to descend.

Only usable against a server that has declared support for directory listing; other servers return an error.`

export const inputSchema = lazySchema(() =>
  z.object({
    server: z.string().describe('The MCP server name'),
    uri: z.string().describe('The directory resource URI to list'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() =>
  z.object({
    resources: z.array(
      z.object({
        uri: z.string(),
        name: z.string(),
        mimeType: z.string().optional(),
      }),
    ),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const ReadMcpResourceDirTool = buildTool({
  name: READ_MCP_RESOURCE_DIR_TOOL_NAME,
  searchHint: 'list direct children of a directory resource on an MCP server',
  shouldDefer: true,
  maxResultSizeChars: 100_000,
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return `${input.server} ${input.uri}`
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
    return 'ReadMcpResourceDir'
  },
  renderToolUseMessage(input) {
    if (!input.uri || !input.server) return null
    return `List directory resource "${input.uri}" from server "${input.server}"`
  },
  async call(input, { abortController, options: { mcpClients } }) {
    const { server: serverName, uri } = input
    const client = mcpClients.find(c => c.name === serverName)

    if (!client) {
      throw new Error(
        `Server "${serverName}" not found. Available servers: ${mcpClients.map(c => c.name).join(', ')}`,
      )
    }

    if (client.type !== 'connected') {
      throw new Error(`Server "${serverName}" is not connected`)
    }

    if (!client.capabilities?.resources) {
      throw new Error(`Server "${serverName}" does not support resources`)
    }

    const resources: Output['resources'] = []
    let cursor: string | undefined
    let pages = 0
    const MAX_PAGES = 20

    do {
      const result = await client.client.request(
        {
          method: 'resources/directory/read',
          params: { uri, ...(cursor ? { cursor } : {}) },
        },
        ListResourcesResultSchema,
        { signal: abortController.signal },
      )
      for (const r of result.resources) {
        resources.push({
          uri: r.uri,
          name: r.name,
          ...(r.mimeType !== undefined ? { mimeType: r.mimeType } : {}),
        })
      }
      cursor = result.nextCursor
      pages++
    } while (cursor && pages < MAX_PAGES)

    return { data: { resources } }
  },
  mapToolResultToToolResultBlockParam(data, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify(data),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
