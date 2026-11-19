import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { formatDuration } from '../../utils/format.js'
import { lazySchema } from '../../utils/lazySchema.js'

const LIST_AGENTS_TOOL_NAME = 'ListAgents'

const DESCRIPTION = `List active and recent subagents, background agent tasks, and named teammates in the current session.`

const PROMPT = `List reachable agents (active and recent subagents, background tasks, and named teammates) so you can inspect their status or message them with SendMessage.`

export const inputSchema = lazySchema(() =>
  z.strictObject({
    channel: z
      .string()
      .max(256)
      .optional()
      .describe('Optional filter channel; leave unset in local sessions.'),
    q: z
      .string()
      .max(256)
      .optional()
      .describe('Optional substring filter on agent name or description.'),
    cursor: z
      .string()
      .max(256)
      .optional()
      .describe('Pagination cursor from a previous listing.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const RowSchema = z.object({
  name: z.string().optional(),
  ref: z.string().optional(),
  id: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  description: z.string().optional(),
})

export const outputSchema = lazySchema(() =>
  z.object({
    listing: z.string().describe('Formatted list of reachable agents'),
    sections: z
      .array(
        z.object({
          kind: z.string(),
          total: z.number(),
          rows: z.array(RowSchema),
        }),
      )
      .optional(),
    teamName: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const ListAgentsTool = buildTool({
  name: LIST_AGENTS_TOOL_NAME,
  aliases: ['ListPeers'],
  searchHint: 'list agents you can SendMessage to',
  whenToUse:
    'List active subagents, background tasks, and teammates in this session.',
  shouldDefer: true,
  maxResultSizeChars: 30_000,
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput() {
    return 'list agents'
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
    return 'ListAgents'
  },
  renderToolUseMessage() {
    return null
  },
  async call(input, { getAppState }) {
    const state = getAppState()
    const nameById = new Map<string, string>()
    for (const [name, id] of state.agentNameRegistry.entries()) {
      nameById.set(id, name)
    }

    const query = input.q?.trim().toLowerCase()
    const runningRows: z.infer<typeof RowSchema>[] = []
    const completedRows: z.infer<typeof RowSchema>[] = []
    const lines: string[] = []

    const now = Date.now()
    for (const [id, task] of Object.entries(state.tasks)) {
      if (!task) continue
      if (
        task.type !== 'local_agent' &&
        task.type !== 'remote_agent' &&
        task.type !== 'in_process_teammate'
      ) {
        continue
      }
      const name =
        nameById.get(id) ??
        (task.type === 'in_process_teammate'
          ? task.identity.agentName
          : undefined)
      const desc = task.description ?? ''
      if (
        query &&
        !id.toLowerCase().includes(query) &&
        !(name ?? '').toLowerCase().includes(query) &&
        !desc.toLowerCase().includes(query)
      ) {
        continue
      }
      const elapsed = formatDuration(
        Math.max(0, (task.endTime ?? now) - task.startTime),
      )
      const row: z.infer<typeof RowSchema> = {
        id,
        ...(name ? { name, ref: `@${name}` } : { ref: id }),
        type: task.type,
        status: task.status,
        ...(desc ? { description: desc } : {}),
      }
      if (task.status === 'running' || task.status === 'pending') {
        runningRows.push(row)
      } else {
        completedRows.push(row)
      }
      lines.push(
        `- ${name ? `@${name} (${id})` : id} [${task.type}] ${task.status} (${elapsed})${desc ? `: ${desc}` : ''}`,
      )
    }

    const header = state.teamContext?.teamName
      ? `Team: ${state.teamContext.teamName}\n`
      : ''
    const listing =
      lines.length > 0
        ? `${header}${lines.join('\n')}`
        : `${header}No active or recent subagents in this session.`

    return {
      data: {
        listing,
        sections: [
          { kind: 'running', total: runningRows.length, rows: runningRows },
          {
            kind: 'completed',
            total: completedRows.length,
            rows: completedRows,
          },
        ],
        ...(state.teamContext?.teamName
          ? { teamName: state.teamContext.teamName }
          : {}),
      },
    }
  },
  mapToolResultToToolResultBlockParam(data, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: data.listing,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
