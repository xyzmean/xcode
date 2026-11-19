import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { queryOpenAIModel, sideQueryOpenAI, type OpenAIPromptSuggestionRequest } from '../src/services/api/openai.js'
import { getIsInteractive, setIsInteractive } from '../src/bootstrap/state.js'
import { executePromptSuggestion } from '../src/services/PromptSuggestion/promptSuggestion.js'
import type { REPLHookContext } from '../src/utils/hooks/postSamplingHooks.js'
import { createAssistantMessage, createUserMessage } from '../src/utils/messages.js'
import { asSystemPrompt } from '../src/utils/systemPromptType.js'

type Item = {
  type: string
  id?: string
  call_id?: string
  name?: string
  arguments?: string
  output?: string
}

type RequestBody = {
  model: string
  input: Item[]
  parallel_tool_calls?: boolean
  tools: { name: string; parameters: { required: string[]; properties: Record<string, { type: string }> } }[]
}

test('Responses API runs parallel reads, edits, writes and a delegated check', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xcode-responses-'))
  const home = join(dir, 'home')
  const source = join(dir, 'source.txt')
  const reference = join(dir, 'reference.txt')
  const output = join(dir, 'output.txt')
  const legacyConfig = join(home, '.claude', 'settings.json')
  await mkdir(join(home, '.claude'), { recursive: true })
  await writeFile(legacyConfig, '{invalid legacy settings')
  await writeFile(source, '  before\n  untouched\n')
  await writeFile(reference, 'reference-value\n')

  const requests: RequestBody[] = []
  const unexpectedRequests: string[] = []
  const call = (id: string, name: string, input: object): Item => ({
    type: 'function_call',
    id: `fc_${id}`,
    call_id: `call_${id}`,
    name,
    arguments: JSON.stringify(input),
  })
  const calls = [
    [
      call('source', 'Read', { file_path: source }),
      call('reference', 'Read', { file_path: reference }),
    ],
    [
      call('edit', 'Edit', { file_path: source, old_string: '  before', new_string: '  after' }),
      call('write', 'Write', { file_path: output, content: 'reference-value\n' }),
      call('agent', 'Agent', {
        description: 'Check reference value',
        prompt: `Independently confirm the value in ${reference}; do not modify it.`,
        subagent_type: 'general-purpose',
        model: 'openai/gpt-6.2-sol',
      }),
    ],
    [call('agent_reference', 'Read', { file_path: reference })],
  ]
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const pathname = new URL(req.url).pathname
      if (req.method !== 'POST' || pathname !== '/responses') {
        unexpectedRequests.push(`${req.method} ${pathname}`)
        return new Response(null, { status: 404 })
      }
      const body = await req.json() as RequestBody
      const turn = requests.push(body)
      const id = `resp_${turn}`
      const events: object[] = [{ type: 'response.created', response: { id } }]
      const batch = calls[turn - 1]
      if (batch) {
        batch.forEach((item, output_index) => {
          events.push({ type: 'response.output_item.added', output_index, item: { ...item, arguments: '' } })
        })
        batch.forEach(({ id: item_id, arguments: args }, output_index) => {
          if (output_index !== 0) {
            events.push({ type: 'response.function_call_arguments.delta', item_id, delta: args!.slice(0, 10) })
          }
        })
        for (let i = batch.length - 1; i >= 0; i--) {
          const { arguments: args, ...item } = batch[i]!
          if (i !== 0) {
            events.push({ type: 'response.function_call_arguments.delta', item_id: item.id, delta: args!.slice(10) })
          } else if (turn !== 3) {
            events.push({ type: 'response.function_call_arguments.done', item_id: item.id, arguments: args })
          }
          events.push({ type: 'response.output_item.done', item: turn === 3 ? batch[i] : item })
        }
      } else {
        const isParent = body.input.some(item => item.type === 'function_call_output' && item.call_id === 'call_agent')
        const item = { id: `msg_${turn}`, type: 'message' }
        events.push(
          { type: 'response.output_item.added', item },
          { type: 'response.output_text.delta', item_id: item.id, delta: isParent ? 'Changes verified.' : 'Reference checked.' },
          { type: 'response.output_item.done', item },
        )
      }
      events.push({ type: 'response.completed', response: { id, usage: { input_tokens: 100, output_tokens: 20 } } })
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''), {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    },
  })

  try {
    const binary = process.env.XCODE_TEST_BINARY ??
      join(import.meta.dirname, '..', 'dist', `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`, process.platform === 'win32' ? 'xcode.exe' : 'xcode')
    const run = async (args: string[]) => {
      const proc = Bun.spawn([binary, '--print', '--no-session-persistence', ...args], {
        cwd: dir,
        env: {
          PATH: process.env.PATH,
          HOME: home,
          USERPROFILE: home,
          OPENAI_API_KEY: 'local-test-only',
          OPENAI_BASE_URL: server.url.origin,
          ANTHROPIC_API_KEY: 'local-anthropic-test-only',
          ANTHROPIC_BASE_URL: server.url.origin,
          ANTHROPIC_MODEL: 'claude-opus-4-6',
          CLAUDE_CODE_USE_BEDROCK: '1',
          CLAUDE_CODE_USE_VERTEX: '1',
          CLAUDE_CODE_USE_FOUNDRY: '1',
          CLAUDE_CODE_ENABLE_TELEMETRY: '1',
          OTEL_EXPORTER_OTLP_ENDPOINT: server.url.origin,
        },
        stdout: 'pipe',
        stderr: 'pipe',
        signal: AbortSignal.timeout(20_000),
      })
      return Promise.all([proc.exited, proc.stdout.text(), proc.stderr.text()])
    }
    const [code, stdout, stderr] = await run([
      '--debug-to-stderr', 'Fix source.txt, write a derived output.txt, and delegate a reference check.',
      '--tools', 'Read,Edit,Write,Agent', '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Read,Edit,Write,Agent', '--max-turns', '6',
    ])
    expect({ code, stderr, stdout, turns: requests.length }).toMatchObject({
      code: 0,
      stdout: expect.stringContaining('Changes verified.'),
      turns: 5,
    })
    expect(await readFile(source, 'utf8')).toBe('  after\n  untouched\n')
    expect(await readFile(output, 'utf8')).toBe('reference-value\n')
    expect(requests[0]).toMatchObject({ model: 'gpt-6.2-sol', parallel_tool_calls: true })
    const tools = Object.fromEntries(requests[0]!.tools.map(tool => [tool.name, tool.parameters]))
    expect(tools.Edit).toMatchObject({
      required: ['file_path', 'old_string', 'new_string'],
      properties: { replace_all: { type: 'boolean' } },
    })
    expect(tools.Write!.required).toEqual(['file_path', 'content'])
    expect(tools.Agent!.required).toEqual(['description', 'prompt'])
    expect(tools.Agent!.properties.model).toMatchObject({ type: 'string' })
    const toolOutputs = (request: RequestBody) => Object.fromEntries(request.input
      .filter(item => item.type === 'function_call_output')
      .map(item => [item.call_id, item.output]))
    expect(toolOutputs(requests[1]!)).toMatchObject({
      call_source: expect.stringContaining('before'),
      call_reference: expect.stringContaining('reference-value'),
    })
    expect(toolOutputs(requests[3]!)).toMatchObject({
      call_agent_reference: expect.stringContaining('reference-value'),
    })
    expect(requests[2]!.model).toBe('gpt-6.2-sol')
    expect(toolOutputs(requests[4]!)).toMatchObject({
      call_edit: expect.not.stringContaining('[Tool Error]'),
      call_write: expect.not.stringContaining('[Tool Error]'),
      call_agent: expect.stringContaining('Reference checked.'),
    })
    expect(await readdir(home)).toContain('.xcode')
    expect(await readdir(join(home, '.claude'))).toEqual(['settings.json'])
    expect(await readFile(legacyConfig, 'utf8')).toBe('{invalid legacy settings')
    const [legacyCode, legacyOutput, legacyError] = await run(['--model', 'claude-opus-4-6', 'Hello.'])
    expect(legacyCode).toBe(1)
    expect(legacyOutput + legacyError).toContain('xCode requires an OpenAI model')
    expect(requests).toHaveLength(5)
    expect(unexpectedRequests).toEqual([])
  } finally {
    await server.stop(true)
    await rm(dir, { recursive: true, force: true })
  }
}, 30_000)

test('native xCode uses system ripgrep for Glob and Grep', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xcode-search-'))
  const binary = process.env.XCODE_TEST_BINARY ??
    join(import.meta.dirname, '..', 'dist', `${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`, process.platform === 'win32' ? 'xcode.exe' : 'xcode')
  const calls = [
    ['Glob', { pattern: '*.txt' }],
    ['Grep', { pattern: 'search-fixture-marker', output_mode: 'content' }],
    ['Grep', { pattern: 'not-in-fixture' }],
  ] as const
  const outputs = new Map<string, string | undefined>()
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const { input } = await req.json() as RequestBody
      const results = input.filter(item => item.type === 'function_call_output')
      for (const item of results) outputs.set(item.call_id!, item.output)
      const events = [
        ...(results.length ? [
          { type: 'response.output_item.added', item: { id: 'msg_search', type: 'message' }, output_index: 0 },
          { type: 'response.output_text.delta', item_id: 'msg_search', delta: 'Search complete.' },
          { type: 'response.output_item.done', item: { id: 'msg_search', type: 'message' } },
        ] : calls.flatMap(([name, args], index) => {
          const item = { type: 'function_call', id: `fc_${index}`, call_id: `call_${index}`, name }
          return [
            { type: 'response.output_item.added', item: { ...item, arguments: '' }, output_index: index },
            { type: 'response.output_item.done', item: { ...item, arguments: JSON.stringify(args) } },
          ]
        })),
        { type: 'response.completed', response: { id: 'resp_search', usage: { input_tokens: 10, output_tokens: 10 } } },
      ]
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    },
  })
  try {
    await writeFile(join(dir, 'search-fixture.txt'), 'search-fixture-marker\n')
    const run = async (path: string) => {
      outputs.clear()
      const proc = Bun.spawn([
        binary, '--print', '--no-session-persistence', 'Search the fixture.',
        '--tools', 'Glob,Grep', '--allowedTools', 'Glob,Grep', '--max-turns', '3',
      ], {
        cwd: dir,
        env: { PATH: path, HOME: dir, USERPROFILE: dir, OPENAI_API_KEY: 'local-test-only', OPENAI_BASE_URL: server.url.origin },
        stdout: 'pipe', stderr: 'pipe', signal: AbortSignal.timeout(10_000),
      })
      const [, stdout, stderr] = await Promise.all([proc.exited, proc.stdout.text(), proc.stderr.text()])
      expect({ stdout, stderr, results: outputs.size }).toMatchObject({ results: 3 })
    }
    await run(process.env.PATH!)
    expect(outputs.get('call_0')).toContain('search-fixture.txt')
    expect(outputs.get('call_1')).toContain('search-fixture-marker')
    expect(outputs.get('call_2')).toMatch(/no files found|no matches found/i)

    await run(dir)
    for (const result of outputs.values()) expect(result).toContain('Install ripgrep (rg)')
  } finally {
    await server.stop(true)
    await rm(dir, { recursive: true, force: true })
  }
}, 25_000)

test('interactive OpenAI prompt suggestions preserve the parent request and discard tool calls', async () => {
  const requests: Record<string, unknown>[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      requests.push(await req.json() as Record<string, unknown>)
      const turn = requests.length
      const item = { type: 'message', id: `msg_${turn}` }
      const call = { type: 'function_call', id: 'fc_unexpected', call_id: 'call_unexpected', name: 'FixtureTool', arguments: '{}' }
      const events = [
        { type: 'response.created', response: { id: `resp_${turn}` } },
        { type: 'response.output_item.added', item },
        { type: 'response.output_text.delta', item_id: item.id, delta: turn === 1 ? 'Баг исправлен' : 'запусти тесты' },
        { type: 'response.output_item.done', item },
        ...(turn === 3 ? [
          { type: 'response.output_item.added', item: call },
          { type: 'response.output_item.done', item: call },
        ] : []),
        { type: 'response.completed' },
      ]
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
    },
  })
  const env = { OPENAI_API_KEY: 'local-test-only', OPENAI_BASE_URL: server.url.origin }
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  const wasInteractive = getIsInteractive()
  Object.assign(process.env, env)
  const state = { promptSuggestionEnabled: false, promptSuggestion: null as unknown, elicitation: { queue: [] }, toolPermissionContext: { mode: 'default' } }
  const messages = [
    createUserMessage({ content: 'Исправь баг, потом запусти тесты' }),
    createAssistantMessage({ content: 'Нашёл причину' }),
    createUserMessage({ content: 'Исправь причину' }),
  ]
  const context = {
    querySource: 'repl_main_thread',
    messages: [...messages, createAssistantMessage({ content: 'Баг исправлен' })],
    toolUseContext: {
      options: { mainLoopModel: 'gpt-6.2-sol' },
      getAppState: () => state,
      setAppState: (update: (prev: typeof state) => typeof state) => Object.assign(state, update(state)),
    },
  } as unknown as REPLHookContext
  try {
    let capture: OpenAIPromptSuggestionRequest | undefined
    for await (const _ of queryOpenAIModel(messages, asSystemPrompt(['Fixture instructions.']), { type: 'adaptive' }, [], AbortSignal.timeout(5000), {
      querySource: 'repl_main_thread',
      model: 'gpt-6.2-sol',
      fastMode: true,
      isNonInteractiveSession: false,
      agents: [],
      hasAppendSystemPrompt: false,
      mcpTools: [],
      getToolPermissionContext: context.toolUseContext.getAppState as never,
      extraToolSchemas: [{ name: 'FixtureTool', input_schema: { type: 'object', properties: {} } }],
      onPromptSuggestionRequest: request => { capture = request },
    })) { /* drain the parent response */ }
    expect(capture).toBeFunction()
    setIsInteractive(true)
    await executePromptSuggestion(context, capture)
    expect(requests).toHaveLength(1)
    state.promptSuggestionEnabled = true
    setIsInteractive(false)
    await executePromptSuggestion(context, capture)
    expect(requests).toHaveLength(1)
    setIsInteractive(true)
    await executePromptSuggestion(context, capture)
    expect(requests).toHaveLength(2)
    const { input: parentInput, ...parentFields } = requests[0]!
    const { input: suggestionInput, ...suggestionFields } = requests[1]!
    expect(parentFields).toMatchObject({ model: 'gpt-6.2-sol-fast', store: false, tools: [{ name: 'FixtureTool' }] })
    expect(suggestionFields).toEqual(parentFields)
    expect(suggestionInput).toEqual([
      ...parentInput as unknown[],
      { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Баг исправлен' }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: expect.stringContaining('[SUGGESTION MODE:') }] },
    ])
    expect(state.promptSuggestion).toMatchObject({ text: 'запусти тесты', shownAt: 0, acceptedAt: 0, generationRequestId: expect.any(String) })
    state.promptSuggestion = null
    await executePromptSuggestion(context, capture)
    expect(requests).toHaveLength(3)
    expect(state.promptSuggestion).toBeNull()
  } finally {
    setIsInteractive(wasInteractive)
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await server.stop(true)
  }
})

test.skipIf(process.platform === 'win32')('prompt suggestion is editable before Enter sends it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xcode-suggestion-pty-'))
  const firstPrompt = 'Explain the fixture'
  const secondPrompt = 'Describe the output'
  const suggestion = 'Show a concise example'
  const editedPrompt = `${suggestion} please`
  const mainPrompts: string[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      if (new URL(req.url).pathname !== '/responses') return new Response(null, { status: 404 })
      const { input } = await req.json() as {
        input: { role?: string; content?: { text?: string }[] }[]
      }
      const prompt = input.filter(item => item.role === 'user')
        .flatMap(item => item.content?.map(block => block.text ?? '') ?? [])
        .findLast(text => text && !text.startsWith('<system-reminder>')) ?? ''
      const isSuggestion = prompt.includes('[SUGGESTION MODE:')
      if (!isSuggestion) mainPrompts.push(prompt)
      const item = { id: 'msg_fixture', type: 'message' }
      const events = [
        { type: 'response.created', response: { id: 'resp_fixture' } },
        { type: 'response.output_item.added', item },
        { type: 'response.output_text.delta', item_id: item.id, delta: isSuggestion ? suggestion : `Fixture response ${mainPrompts.length}.` },
        { type: 'response.output_item.done', item },
        { type: 'response.completed' },
      ]
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    },
  })

  try {
    await writeFile(join(dir, '.xcode.json'), JSON.stringify({
      theme: 'dark',
      hasCompletedOnboarding: true,
      projects: { [dir]: { hasTrustDialogAccepted: true } },
    }))
    const binary = process.env.XCODE_TEST_BINARY ??
      join(import.meta.dirname, '..', 'dist', `${process.platform}-${process.arch}`, 'xcode')
    let output = ''
    const decoder = new TextDecoder()
    const proc = Bun.spawn([binary, '--tools', ''], {
      cwd: dir,
      terminal: {
        cols: 100,
        rows: 30,
        data(_terminal, data) { output += decoder.decode(data, { stream: true }) },
      },
      env: {
        PATH: process.env.PATH,
        HOME: dir,
        CLAUDE_CONFIG_DIR: dir,
        TERM: 'xterm-256color',
        OPENAI_API_KEY: 'local-test-only',
        OPENAI_BASE_URL: server.url.origin,
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: '1',
        CLAUDE_CODE_NO_FLICKER: '0',
        CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
        DISABLE_AUTOUPDATER: '1',
      },
    })
    const terminal = proc.terminal!
    const rendered = () => Bun.stripANSI(output).replace(/[ \t\u00a0]/g, '')
    const waitFor = async (condition: () => boolean, description: string) => {
      const deadline = Date.now() + 4000
      while (!condition() && proc.exitCode === null && Date.now() < deadline) await Bun.sleep(20)
      if (!condition()) throw new Error(`Missing ${description}; received ${JSON.stringify(mainPrompts)}\n${Bun.stripANSI(output).slice(-3500)}`)
    }

    try {
      await waitFor(() => rendered().includes('?forshortcuts'), 'ready prompt')
      terminal.write(`${firstPrompt}\r`)
      await waitFor(() => rendered().includes('Fixtureresponse1.'), 'first response')
      terminal.write(`${secondPrompt}\r`)
      // Ink may emit only the cells changed from the previous footer.
      await waitFor(() => rendered().includes('Tab') && rendered().includes(suggestion.replaceAll(' ', '')), 'prompt suggestion and keyboard hint')
      expect(mainPrompts).toEqual([firstPrompt, secondPrompt])

      terminal.write('\r')
      // Leave time for an unintended request before sending a different keystroke.
      await Bun.sleep(100)
      expect(mainPrompts).toEqual([firstPrompt, secondPrompt])

      const beforeInsert = output.length
      terminal.write('\t')
      await waitFor(() => output.length > beforeInsert, 'draft redraw after Tab')
      expect(mainPrompts).toEqual([firstPrompt, secondPrompt])

      terminal.write(' please')
      await waitFor(() => rendered().includes('please'), 'edited draft')
      expect(mainPrompts).toEqual([firstPrompt, secondPrompt])

      terminal.write('\r')
      await waitFor(() => mainPrompts.length > 2, 'edited prompt request')
      expect(mainPrompts).toEqual([firstPrompt, secondPrompt, editedPrompt])
    } finally {
      proc.kill()
      await proc.exited
    }
  } finally {
    await server.stop(true)
    await rm(dir, { recursive: true, force: true })
  }
}, 15_000)

test('side queries read final function arguments even when there are no deltas', async () => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      const item = { id: 'fc_choice', type: 'function_call', call_id: 'call_choice', name: 'Choose' }
      const events = [
        { type: 'response.output_item.added', item },
        { type: 'response.output_item.done', item: { ...item, arguments: '{"choice":"proceed"}' } },
        { type: 'response.completed' },
      ]
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
    },
  })
  const env = { OPENAI_API_KEY: 'local-test-only', OPENAI_BASE_URL: server.url.origin }
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  try {
    await expect(sideQueryOpenAI({
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'Hello.' }],
    })).rejects.toThrow('xCode requires an OpenAI model')
    const message = await sideQueryOpenAI({
      model: 'gpt-6.2-sol',
      messages: [{ role: 'user', content: 'Choose whether to proceed.' }],
      tools: [{
        name: 'Choose',
        input_schema: { type: 'object', properties: { choice: { type: 'string' } }, required: ['choice'] },
      }],
      tool_choice: { type: 'tool', name: 'Choose' },
    })
    expect(message).toMatchObject({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'call_choice', name: 'Choose', input: { choice: 'proceed' } }],
    })
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await server.stop(true)
  }
})
