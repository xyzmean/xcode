import * as path from 'path'
import { z } from 'zod/v4'
import { getSessionId, setOriginalCwd } from '../../bootstrap/state.js'
import { clearSystemPromptSections } from '../../constants/systemPromptSections.js'
import { logEvent } from '../../services/analytics/index.js'
import type { Tool } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { clearMemoryFileCaches } from '../../utils/claudemd.js'
import { getCwd } from '../../utils/cwd.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { findCanonicalGitRoot } from '../../utils/git.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getPlanSlug, getPlansDirectory } from '../../utils/plans.js'
import { setCwd } from '../../utils/Shell.js'
import { saveWorktreeState } from '../../utils/sessionStorage.js'
import {
  createWorktreeForSession,
  getCurrentWorktreeSession,
  validateWorktreeSlug,
} from '../../utils/worktree.js'
import { ENTER_WORKTREE_TOOL_NAME } from './constants.js'
import { getEnterWorktreeToolPrompt } from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    name: z
      .string()
      .superRefine((s, ctx) => {
        try {
          validateWorktreeSlug(s)
        } catch (e) {
          ctx.addIssue({ code: 'custom', message: (e as Error).message })
        }
      })
      .optional()
      .describe(
        'Optional name for a new worktree. Each "/"-separated segment may contain only letters, digits, dots, underscores, and dashes; max 64 chars total. A random name is generated if not provided. Mutually exclusive with `path`.',
      ),
    path: z
      .string()
      .optional()
      .describe(
        'Path to an existing worktree to switch into instead of creating a new one. Must appear in `git worktree list` for the current repo. Mutually exclusive with `name`.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    worktreePath: z.string(),
    worktreeBranch: z.string().optional(),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const EnterWorktreeTool: Tool<InputSchema, Output> = buildTool({
  name: ENTER_WORKTREE_TOOL_NAME,
  searchHint: 'create an isolated git worktree and switch into it',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Creates an isolated worktree (via git or configured hooks) and switches the session into it'
  },
  async prompt() {
    return getEnterWorktreeToolPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'Creating worktree'
  },
  shouldDefer: true,
  toAutoClassifierInput(input) {
    return input.name ?? ''
  },
  renderToolUseMessage,
  renderToolResultMessage,
  async call(input) {
    // Validate not already in a worktree created by this session
    if (getCurrentWorktreeSession()) {
      throw new Error('Already in a worktree session')
    }

    if (input.name && input.path) {
      throw new Error('`name` and `path` are mutually exclusive')
    }

    if (input.path) {
      const targetPath = path.resolve(getCwd(), input.path)
      const listResult = await execFileNoThrow(
        'git',
        ['worktree', 'list', '--porcelain'],
      )
      if (listResult.code !== 0) {
        throw new Error(
          `Failed to list git worktrees: ${listResult.stderr || listResult.stdout}`,
        )
      }
      const worktrees: { path: string; branch?: string }[] = []
      let current: { path: string; branch?: string } | null = null
      for (const line of listResult.stdout.split(/\r?\n/)) {
        if (line.startsWith('worktree ')) {
          if (current) worktrees.push(current)
          current = { path: path.resolve(line.slice('worktree '.length).trim()) }
        } else if (line.startsWith('branch refs/heads/') && current) {
          current.branch = line.slice('branch refs/heads/'.length).trim()
        }
      }
      if (current) worktrees.push(current)

      const matched = worktrees.find(w => w.path === targetPath)
      if (!matched) {
        throw new Error(
          `Path "${input.path}" is not in \`git worktree list\` for the current repository`,
        )
      }

      process.chdir(matched.path)
      setCwd(matched.path)
      setOriginalCwd(matched.path)
      clearSystemPromptSections()
      clearMemoryFileCaches()
      getPlansDirectory.cache.clear?.()

      const branchInfo = matched.branch ? ` on branch ${matched.branch}` : ''
      return {
        data: {
          worktreePath: matched.path,
          ...(matched.branch ? { worktreeBranch: matched.branch } : {}),
          message: `Switched into existing worktree at ${matched.path}${branchInfo}.`,
        },
      }
    }

    // Resolve to main repo root so worktree creation works from within a worktree
    const mainRepoRoot = findCanonicalGitRoot(getCwd())
    if (mainRepoRoot && mainRepoRoot !== getCwd()) {
      process.chdir(mainRepoRoot)
      setCwd(mainRepoRoot)
    }

    const slug = input.name ?? getPlanSlug()

    const worktreeSession = await createWorktreeForSession(getSessionId(), slug)

    process.chdir(worktreeSession.worktreePath)
    setCwd(worktreeSession.worktreePath)
    setOriginalCwd(getCwd())
    saveWorktreeState(worktreeSession)
    // Clear cached system prompt sections so env_info_simple recomputes with worktree context
    clearSystemPromptSections()
    // Clear memoized caches that depend on CWD
    clearMemoryFileCaches()
    getPlansDirectory.cache.clear?.()

    logEvent('tengu_worktree_created', {
      mid_session: true,
    })

    const branchInfo = worktreeSession.worktreeBranch
      ? ` on branch ${worktreeSession.worktreeBranch}`
      : ''

    return {
      data: {
        worktreePath: worktreeSession.worktreePath,
        worktreeBranch: worktreeSession.worktreeBranch,
        message: `Created worktree at ${worktreeSession.worktreePath}${branchInfo}. The session is now working in the worktree. Use ExitWorktree to leave mid-session, or exit the session to be prompted.`,
      },
    }
  },
  mapToolResultToToolResultBlockParam({ message }, toolUseID) {
    return {
      type: 'tool_result',
      content: message,
      tool_use_id: toolUseID,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
