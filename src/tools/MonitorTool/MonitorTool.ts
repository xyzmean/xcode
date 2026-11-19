import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { lookup } from 'dns/promises'
import { isIP } from 'net'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { createTaskStateBase } from '../../Task.js'
import type { LocalShellTaskState } from '../../tasks/LocalShellTask/guards.js'
import {
  registerMonitorKillHandler,
  unregisterMonitorKillHandler,
} from '../../tasks/LocalShellTask/killShellTasks.js'
import { getCwd } from '../../utils/cwd.js'
import { formatDuration } from '../../utils/format.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js'
import {
  registerTask,
  updateTaskState,
} from '../../utils/task/framework.js'

const MONITOR_TOOL_NAME = 'Monitor'
const DEFAULT_TIMEOUT_MS = 300_000
const MAX_TIMEOUT_MS = 1_800_000
const MAX_WS_FRAME_BYTES = 1_048_576
const RFC6455_TOKEN_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

const DESCRIPTION = `Start a background monitor that streams stdout lines from a shell command or messages from a WebSocket as notifications.
- Exactly one of \`command\` or \`ws\` must be provided.
- \`timeout_ms\` defaults to ${DEFAULT_TIMEOUT_MS}ms (max ${MAX_TIMEOUT_MS}ms), or pass \`persistent: true\` to run until TaskStop or session end.
- Each stdout line (or WebSocket frame) is delivered as a notification; process exit or socket close ends the watch.`

const PROMPT = `Monitor a shell command or WebSocket in the background and receive notifications for each event.

When you are about to check a log, process or job again and again to catch each new event, use Monitor instead of repeated Bash calls or sleeps.

Parameters:
- description (required): Short human-readable description of what you are monitoring (shown in notifications).
- timeout_ms (optional): Kill the monitor after this deadline. Default ${DEFAULT_TIMEOUT_MS}ms, max ${MAX_TIMEOUT_MS}ms. Ignored when persistent is true.
- persistent (optional): Run for the lifetime of the session (no timeout). Use for session-length watches like PR monitoring or log tails. Stop with TaskStop.
- command (optional): Shell command or script to run. Each stdout line is an event; exit ends the watch.
- ws (optional): WebSocket { url, protocols? } to connect to. Each text frame is an event; binary frames are reported as a placeholder line. Socket close ends the watch. Cannot be combined with command.`

function isPrivateOrLinkLocalIP(addr: string): boolean {
  const ip = addr.replace(/^\[|\]$/g, '').toLowerCase()
  if (ip === '::1' || ip === '::' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) {
    return true
  }
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  const parts = v4.split('.').map(Number)
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) {
    return false
  }
  const [a, b] = parts as [number, number, number, number]
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

async function assertSafeWsUrl(rawUrl: string): Promise<void> {
  const parsed = new URL(rawUrl)
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error(`Unsupported WebSocket scheme: ${parsed.protocol}`)
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) {
    if (isPrivateOrLinkLocalIP(host)) {
      throw new Error(
        `Monitor cannot open a WebSocket to ${host}: the address is in a private, link-local, or cloud-metadata range.`,
      )
    }
    return
  }
  const resolved = await lookup(host, { all: true })
  if (resolved.length === 0) {
    throw new Error(`Monitor could not resolve ${host}`)
  }
  for (const entry of resolved) {
    if (isPrivateOrLinkLocalIP(entry.address)) {
      throw new Error(
        `Monitor cannot open a WebSocket to ${host}: ${host} resolves to ${entry.address}, which is in a private, link-local, or cloud-metadata range.`,
      )
    }
  }
}

export const inputSchema = lazySchema(() =>
  z
    .strictObject({
      description: z
        .string()
        .describe(
          'Short human-readable description of what you are monitoring (shown in notifications).',
        ),
      timeout_ms: z
        .number()
        .int()
        .min(1000)
        .optional()
        .default(DEFAULT_TIMEOUT_MS)
        .describe(
          `Kill the monitor after this deadline. Default ${DEFAULT_TIMEOUT_MS}ms, max ${MAX_TIMEOUT_MS}ms. Ignored when persistent is true.`,
        ),
      persistent: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          'Run for the lifetime of the session (no timeout). Use for session-length watches like PR monitoring or log tails. Stop with TaskStop.',
        ),
      command: z
        .string()
        .optional()
        .describe(
          'Shell command or script. Each stdout line is an event; exit ends the watch.',
        ),
      ws: z
        .object({
          url: z.string().refine(
            raw => {
              try {
                const u = new URL(raw)
                return (
                  (u.protocol === 'ws:' || u.protocol === 'wss:') &&
                  !u.username &&
                  !u.password &&
                  !/[\t\n\r]/.test(raw) &&
                  /^[\x00-\x7F]*$/.test(raw)
                )
              } catch {
                return false
              }
            },
            {
              message:
                'url must be a valid ASCII ws:// or wss:// URL with no userinfo or whitespace',
            },
          ),
          protocols: z
            .array(
              z
                .string()
                .regex(RFC6455_TOKEN_RE, 'protocol must be an RFC 6455 token'),
            )
            .refine(arr => new Set(arr).size === arr.length, {
              message: 'protocols must be unique',
            })
            .optional(),
        })
        .optional()
        .describe(
          'WebSocket to open. Each text frame is an event; binary frames are reported as a placeholder line. Socket close ends the watch. Cannot be combined with command.',
        ),
    })
    .refine(v => Boolean(v.command) !== Boolean(v.ws), {
      message: 'Provide exactly one of `command` or `ws`',
    })
    .refine(v => v.persistent || v.timeout_ms <= MAX_TIMEOUT_MS, {
      message: `timeout_ms must be <= ${MAX_TIMEOUT_MS}`,
      path: ['timeout_ms'],
    }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const outputSchema = lazySchema(() =>
  z.object({
    taskId: z.string().describe('ID of the background monitor task.'),
    timeoutMs: z
      .number()
      .describe('Timeout deadline in milliseconds (0 when persistent).'),
    persistent: z
      .boolean()
      .optional()
      .describe('No timeout — runs until TaskStop or session end.'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

function notifyMonitor(
  taskId: string,
  description: string,
  line: string,
): void {
  enqueuePendingNotification({
    value: `<monitor-notification task-id="${taskId}" description="${description}">\n${line}\n</monitor-notification>`,
    mode: 'task-notification',
  })
}

export const MonitorTool = buildTool({
  name: MONITOR_TOOL_NAME,
  searchHint:
    'watch, monitor, or keep an eye on a process/log/command or WebSocket — stream each stdout line as a live notification',
  whenToUse:
    'When you are about to check a log, process or job again and again to catch each new event, use it and not repeated Bash calls or sleeps.',
  shouldDefer: true,
  maxResultSizeChars: 10_000,
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    return input.ws ? `websocket ${input.ws.url}` : (input.command ?? input.description)
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
    return 'Monitor'
  },
  getToolUseSummary(input) {
    return input?.description ? input.description.slice(0, 80) : null
  },
  getActivityDescription(input) {
    return input?.description ? `Monitoring: ${input.description}` : 'Monitoring'
  },
  renderToolUseMessage(input) {
    return input.description || null
  },
  async call(input, context) {
    const taskId = `mon_${randomUUID().slice(0, 8)}`
    const persistent = Boolean(input.persistent)
    const timeoutMs = persistent
      ? 0
      : Math.min(input.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
    const setAppState = context?.setAppState
    const killController = new AbortController()

    const registerMonitorTask = (commandLabel: string) => {
      if (!setAppState) return
      const taskState: LocalShellTaskState = {
        ...createTaskStateBase(
          taskId,
          'local_bash',
          input.description,
          context?.toolUseId,
        ),
        type: 'local_bash',
        status: 'running',
        command: commandLabel,
        completionStatusSentInAttachment: false,
        shellCommand: null,
        lastReportedTotalLines: 0,
        isBackgrounded: true,
        agentId: context?.agentId,
        kind: 'monitor',
      }
      registerTask(taskState, setAppState)
    }

    const finishMonitorTask = (
      status: 'completed' | 'failed' | 'killed',
      code = 0,
    ) => {
      unregisterMonitorKillHandler(taskId)
      if (!setAppState) return
      updateTaskState<LocalShellTaskState>(taskId, setAppState, task => {
        if (task.status === 'killed') return task
        return {
          ...task,
          status,
          result: { code, interrupted: status === 'killed' },
          endTime: Date.now(),
        }
      })
    }

    if (input.command) {
      registerMonitorTask(input.command)
      const child = spawn('bash', ['-lc', input.command], {
        cwd: getCwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      registerMonitorKillHandler(taskId, () => {
        killController.abort()
      })
      killController.signal.addEventListener('abort', () => {
        try {
          child.kill('SIGTERM')
        } catch {
          // ignore
        }
      })

      let buffer = ''
      let eventCount = 0
      const flushLines = (chunk: Buffer, prefix = '') => {
        buffer += chunk.toString('utf8')
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.trim().length > 0) {
            eventCount++
            notifyMonitor(taskId, input.description, `${prefix}${line}`)
          }
        }
      }

      child.stdout?.on('data', (chunk: Buffer) => flushLines(chunk))
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8').trim()
        if (text) {
          eventCount++
          notifyMonitor(taskId, input.description, `[stderr] ${text}`)
        }
      })

      const timer = persistent
        ? undefined
        : setTimeout(() => {
            child.kill('SIGTERM')
            notifyMonitor(
              taskId,
              input.description,
              `[monitor expired after ${timeoutMs}ms (${eventCount} events)]`,
            )
            finishMonitorTask('completed', 0)
          }, timeoutMs)
      timer?.unref?.()

      child.once('exit', (code, signal) => {
        if (timer) clearTimeout(timer)
        if (buffer.trim().length > 0) {
          notifyMonitor(taskId, input.description, buffer.trim())
        }
        notifyMonitor(
          taskId,
          input.description,
          `[monitor exited: code=${code ?? 'null'} signal=${signal ?? 'none'}]`,
        )
        finishMonitorTask(code === 0 ? 'completed' : 'failed', code ?? 1)
      })

      return {
        data: {
          taskId,
          timeoutMs,
          ...(persistent ? { persistent: true } : {}),
        },
      }
    }

    const wsConfig = input.ws!
    await assertSafeWsUrl(wsConfig.url)
    registerMonitorTask(wsConfig.url)

    const socket = new WebSocket(wsConfig.url, wsConfig.protocols)
    registerMonitorKillHandler(taskId, () => {
      try {
        socket.close(1000, 'monitor stopped')
      } catch {
        // ignore
      }
    })
    let eventCount = 0

    const timer = persistent
      ? undefined
      : setTimeout(() => {
          try {
            socket.close(1000, 'monitor timeout')
          } catch {
            // ignore
          }
          notifyMonitor(
            taskId,
            input.description,
            `[WebSocket monitor expired after ${timeoutMs}ms (${eventCount} events)]`,
          )
          finishMonitorTask('completed', 0)
        }, timeoutMs)
    timer?.unref?.()

    socket.addEventListener('message', event => {
      if (typeof event.data === 'string') {
        if (Buffer.byteLength(event.data, 'utf8') > MAX_WS_FRAME_BYTES) {
          notifyMonitor(
            taskId,
            input.description,
            `[Dropped oversized frame (exceeds ${MAX_WS_FRAME_BYTES} bytes); closing]`,
          )
          socket.close(1009, 'frame too large')
          return
        }
        eventCount++
        notifyMonitor(taskId, input.description, event.data)
      } else {
        const size =
          event.data instanceof ArrayBuffer
            ? event.data.byteLength
            : (event.data as Blob)?.size ?? 0
        eventCount++
        notifyMonitor(
          taskId,
          input.description,
          `[binary frame, ${size} bytes]`,
        )
      }
    })

    socket.addEventListener('error', () => {
      notifyMonitor(taskId, input.description, '[WebSocket error]')
    })

    socket.addEventListener('close', event => {
      if (timer) clearTimeout(timer)
      notifyMonitor(
        taskId,
        input.description,
        `[WebSocket closed: ${event.code}${event.reason ? ` ${event.reason}` : ''}]`,
      )
      finishMonitorTask(event.wasClean ? 'completed' : 'failed', event.code)
    })

    return {
      data: {
        taskId,
        timeoutMs,
        ...(persistent ? { persistent: true } : {}),
      },
    }
  },
  mapToolResultToToolResultBlockParam(data, toolUseID) {
    const durationText = data.persistent
      ? 'persistent — runs until TaskStop or session end'
      : `expires in ${formatDuration(data.timeoutMs, { hideTrailingZeros: true })} unless the source ends first`
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Monitor started (task ${data.taskId}, ${durationText}). You will be notified on each event. Keep working — do not poll or sleep. Events may arrive while you are waiting for the user — an event is not their reply.`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
