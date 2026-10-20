import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { CommandInfo, On } from 'claude-code'

const BAND = {
  plugin: 'skill-suggest',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 30,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const COMMANDS: CommandInfo[] = [
  { name: 'anthropic-skills:pptx', description: 'Create slide decks, pitch decks and presentations as .pptx', source: 'plugin', plugin: 'anthropic-skills' },
  { name: 'marketing:seo-audit', description: 'Run an SEO audit with keyword research and content gaps', source: 'plugin', plugin: 'marketing' },
  { name: 'dataviz', description: 'Create charts, graphs, plots and dashboards', source: 'user' },
  { name: 'clear', description: 'Clear the conversation', source: 'builtin' },
]

type World = {
  isPlaced?: boolean
  submitted: { text: string; context?: readonly string[] }[]
  modelReply: string
  opened?: string[]
}

// The engine beneath the plugin: each hook here answers as a session would.
function engine(on: On, world: World): void {
  mock.clock(on)
  mock.store(on)
  on('command.register', () => ({ value: { command: 'skill-suggest' } }))
  on('command.list', () => ({ value: COMMANDS }))
  on('session.usage', () => ({ value: { startedAt: 0, context: {} } as never }))
  on('session.surfaces', () => ({ value: ['terminal'] as const }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // The engine's own drawing, where the plugin draws nothing.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('ui.open', (_, e) => {
    world.opened?.push(e.id)
    return {
      value: world.isPlaced === false ? { isPlaced: false as const, reason: 'no surface places panes' } : { isPlaced: true as const },
    }
  })
  on('ui.close', () => ({ value: undefined }))
  on('prompt.edit', (_, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length }
  })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('prompt.submit', (_, e) => {
    world.submitted.push({ text: e.text, context: e.context })
    return { text: e.text, context: e.context }
  })
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: world.modelReply,
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }))
}

// Typing is not raised in a test; `/skill-suggest <brief>` runs the same
// matching the prompt box's edits do.
async function type($: Engine, text: string): Promise<void> {
  await $.command.run({
    command: 'skill-suggest',
    args: text,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
}

function typed(text: string) {
  return { text, origin: { kind: 'composer' }, wait: false } as const
}

test('pills follow the draft, on terminal and desktop', async ($, on) => {
  engine(on, { submitted: [], modelReply: '[]' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await type($, 'Build a pitch deck for our Series A with ten slides')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const pill = await ui.find({ key: 'pill:anthropic-skills:pptx' })
    expect(pill?.text).toContain('pptx')
    expect(await ui.find({ key: 'pill:clear' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a picked pill rides along as context when sent', async ($, on) => {
  const world: World = { submitted: [], modelReply: '[]' }
  engine(on, world)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await type($, 'Build a pitch deck for our Series A with ten slides')

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'pill:anthropic-skills:pptx' })
  expect((await ui.find({ key: 'pill:anthropic-skills:pptx' }))?.text).toContain('✓')

  await $.prompt.submit(typed('Build a pitch deck for our Series A with ten slides'))
  await ui.unmount()

  const last = world.submitted.at(-1)
  expect(last?.context?.join('\n')).toContain('`anthropic-skills:pptx`')
})

test('a typed brief is held until skills are picked, then sent with them', async ($, on) => {
  const world: World = {
    submitted: [],
    modelReply: '[{"name":"anthropic-skills:pptx","match":"strong","reason":"It is a slide deck"}]',
  }
  engine(on, world)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  // The band is on screen, so the person's own Enter is held.
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const held = await $.prompt.submit(typed('Build a pitch deck for our Series A with ten slides'))
  expect(held.drop).toContain('pick the skills')
  expect(world.submitted).toHaveLength(0)

  expect((await ui.find({ key: 'send' }))?.text).toContain('Send with 1 skill')
  await ui.press({ key: 'send' })
  await ui.unmount()

  expect(world.submitted).toHaveLength(1)
  expect(world.submitted[0]?.text).toContain('Build a pitch deck')
  expect(world.submitted[0]?.text).toContain('`anthropic-skills:pptx`')
})

test('a brief nothing fits goes straight through', async ($, on) => {
  const world: World = { submitted: [], modelReply: '[]' }
  engine(on, world)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const result = await $.prompt.submit(typed('what time zone is the server configured for please'))
  expect(result.drop).toBeUndefined()
  expect(world.submitted).toHaveLength(1)
  expect(world.submitted[0]?.context).toBeUndefined()
})

test('an open-source pill copies its install commands', async ($, on) => {
  engine(on, { submitted: [], modelReply: '[]' })
  let copied = ''
  on('ui.copy', (_, e) => {
    copied = e.text
    return { value: { isCopied: true } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await type($, 'There is a crash when the login form submits, please fix the bug')

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'pill:systematic-debugging' })
  await ui.unmount()

  expect(copied).toContain('/plugin install superpowers')
})

test('where no band is drawn, a pane shows the pills', async ($, on) => {
  const world: World = { submitted: [], modelReply: '[]', opened: [] }
  engine(on, world)
  await $.session.start({ cwd: '/', surface: 'mobile', isInteractive: true })
  await type($, 'I am trying to create a case study on figma using a figma file design as the context')
  expect(world.opened).toContain('skill-suggest')

  for (const surface of ['mobile', 'vscode', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'skill-suggest',
      component: 'Pane',
      requestId: 'skill-suggest',
      surface,
      props: {
        title: 'Skill suggestions',
        isFocused: false,
        bodyColumns: 60,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 30 },
        view: {},
      },
    })
    expect(await ui.find({ type: 'Button', text: /canvas-design|frontend-design|doc-coauthoring/ })).toBeDefined()
    await ui.unmount()
  }
})

test('where nothing can draw pills, Claude is asked to put the question', async ($, on) => {
  const world: World = {
    submitted: [],
    isPlaced: false,
    modelReply: '[{"name":"anthropic-skills:pptx","match":"strong"},{"name":"canvas-design","match":"good"}]',
  }
  engine(on, world)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const sent = await $.prompt.submit(typed('Build a pitch deck for our Series A with ten slides'))
  expect(sent.drop).toBeUndefined()

  const note = world.submitted[0]?.context?.join('\n') ?? ''
  expect(note).toContain('AskUserQuestion')
  expect(note).toContain('1. pptx (mandatory)')
  expect(note).toContain('2. canvas-design (not installed)')
  expect(note).toContain('Pick only mandatory')
  expect(note).toContain('"label":"All"')
  expect(note).toContain('`anthropic-skills:pptx`')
  expect(note).toContain('/plugin install example-skills@anthropic-agent-skills')
})

test('the command lists the matches as text', async ($, on) => {
  engine(on, { submitted: [], modelReply: '[]', isPlaced: false })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const out = await $.command.run({
    command: 'skill-suggest',
    args: 'Build a pitch deck for our Series A with ten slides',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  expect(out.text).toContain('+ pptx')
  expect(out.text).toContain('Claude will ask')
})
