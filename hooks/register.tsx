import { atom, read, update } from 'claude-code'
import type { CommandInfo, EngineInterface, Register, RenderInput, RenderSurface } from 'claude-code'

import type { Candidate, Phase, SkillKind, Suggestion } from '../types'
import { briefText, catalogText, oneLine, parsePicks, rules } from './ai'
import { CATALOG } from './catalog'
import { buildIndex, rank, shortName } from './match'
import type { Index } from './match'

const PLUGIN = 'skill-suggest'
const PANE = 'skill-suggest'

const suggestions = atom({ plugin: 'skill-suggest', key: 'suggestions' } as const, [])
const selected = atom({ plugin: 'skill-suggest', key: 'selected' } as const, [])
const held = atom({ plugin: 'skill-suggest', key: 'held' } as const, null)
const phase = atom({ plugin: 'skill-suggest', key: 'phase' } as const, 'typing')
const isHidden = atom({ plugin: 'skill-suggest', key: 'isHidden' } as const, false)
const isReviewed = atom({ plugin: 'skill-suggest', key: 'isReviewed' } as const, false)

// Built-in commands that are not skills, left out when the session gives no
// skill listing to tell them apart.
const UTILITY = new Set(
  (
    'add-dir agents bashes bug clear compact config context copy cost doctor effort exit export fast ' +
    'feedback help hooks ide init keybindings login logout mcp memory model output-style permissions ' +
    'plugin plugins privacy-settings release-notes reload-plugins resume rewind sandbox status ' +
    'statusline tasks terminal-setup theme todos upgrade usage vim'
  ).split(' '),
)

const TAG: Record<SkillKind, string> = {
  yours: 'yours',
  project: 'project',
  org: 'org',
  anthropic: 'Anthropic',
  plugin: 'plugin',
  builtin: 'built-in',
  mcp: 'MCP',
  'open-source': 'open source',
}

const MIN_WORDS = 3
const INVENTORY_TTL_MS = 60_000

let mode: 'ask' | 'live' = 'ask'
let isAiOn = true
let model = 'haiku'

let isEnabled = true
let index: Index | null = null
let candidates: Candidate[] = []
let builtAt = 0
let lastSignature = ''

// What this session's surfaces have shown so far: the band above the prompt
// is drawn on some surfaces only, and a pane stands in where it is not.
let bandSurface: RenderSurface | null = null
let paneSurface: RenderSurface | null = null
let lastOrigin = 'none yet'
let editsSeen = 0
let paneState = 'not opened'
let isPaneDismissed = false

async function loadIndex($: EngineInterface): Promise<Index> {
  const now = await $.clock.now()
  if (index && now - builtAt < INVENTORY_TTL_MS) return index

  const installed = await inventory($)
  const openSource = CATALOG.map<Candidate>(c => ({
    name: c.name,
    description: c.description,
    kind: 'open-source',
    origin: c.source,
    install: c.install,
  }))
  candidates = [...installed, ...openSource]
  index = buildIndex(candidates)
  builtAt = now

  return index
}

async function onDraft($: EngineInterface, text: string): Promise<void> {
  if (!isEnabled || (await read($, phase)) !== 'typing') return
  if (text.trimStart().startsWith('/')) return

  // An empty box (a send, a clear, a client syncing its composer) leaves
  // the suggestions where they are; the next brief replaces them.
  if (text.trim() === '') {
    lastSignature = ''
    return
  }

  const words = text.trim().split(/\s+/).length
  const ranked = words < MIN_WORDS ? [] : rank(await loadIndex($), text, 8)
  const signature = ranked.map(s => s.name + s.match).join('|')
  if (signature === lastSignature) return
  lastSignature = signature

  // A skill the person already picked stays on the band while they type.
  const picked = await read($, selected)
  const previous = await read($, suggestions)
  const kept = previous.filter(s => picked.includes(s.name) && !ranked.some(r => r.name === s.name))
  await update($, suggestions, () => [...ranked, ...kept])
  if (ranked.length > 0 && !isPaneDismissed) await show($)
}

// Makes sure something draws the suggestions: the band where a surface has
// drawn it, else a pane. Resolves whether the pane was placed.
async function show($: EngineInterface): Promise<boolean> {
  if (bandSurface !== null) return true

  const opened = await $.ui.open({ id: PANE, title: 'Skill suggestions' })
  paneState = opened.isPlaced ? 'placed' : `not placed (${opened.reason})`
  return opened.isPlaced
}

// Placed is not seen: only a draw of the band or the pane proves a surface
// shows the pills, so only then is a brief held for them.
function isSeen(): boolean {
  return bandSurface !== null || paneSurface !== null
}

function diagnostics(surfaces: readonly string[]): string {
  return (
    `Surfaces: ${surfaces.join(', ') || 'none'} · ` +
    `band: ${bandSurface ? `drawn on ${bandSurface}` : 'not drawn'} · ` +
    `pane: ${paneState}${paneSurface ? `, drawn on ${paneSurface}` : ', not drawn'} · ` +
    `typing edits seen: ${editsSeen} · last prompt from: ${lastOrigin}`
  )
}

async function analyse($: EngineInterface, brief: string): Promise<Suggestion[]> {
  const idx = await loadIndex($)
  const keyword = rank(idx, brief, 8)
  if (!isAiOn) return keyword

  const result = await $.model.complete({
    model,
    prompt: [{ text: rules + catalogText(candidates), cache: true }, { text: briefText(brief) }],
    maxTokens: 600,
    effort: 'low',
    timeoutMs: 15_000,
  }).catch(() => null)

  if (!result?.isAnswered) return keyword
  return parsePicks(result.text, candidates) ?? keyword
}

// Only hold a brief when at least one installed skill clearly fits it; the
// keyword pass is local and free, so most prompts skip the model entirely.
async function isWorthAsking($: EngineInterface, brief: string): Promise<boolean> {
  const keyword = rank(await loadIndex($), brief, 8)
  return keyword.some(s => s.match === 'strong' && s.kind !== 'open-source')
}

async function sendHeld($: EngineInterface, withPicks: boolean): Promise<void> {
  const brief = await read($, held)
  if (brief === null) return

  const picked = withPicks ? await read($, selected) : []
  const chosen = (await read($, suggestions)).filter(s => picked.includes(s.name))
  await reset($)
  lastSignature = ''

  // A plugin's own submission skips its own hooks, so the picks travel in
  // the text itself rather than as context.
  const note = contextFor(chosen)
  await $.prompt.submit({ text: note ? `${brief}\n\n${note}` : brief, asUser: true })
  const box = await $.prompt.read()
  if (box.text.trim() === brief.trim()) await $.prompt.fill({ text: '', mode: 'replace' })
}

async function editHeld($: EngineInterface): Promise<void> {
  const brief = await read($, held)
  await update($, held, () => null)
  await update($, phase, () => 'typing' as Phase)
  await update($, isReviewed, () => true)
  if (brief !== null) await $.prompt.fill({ text: brief, mode: 'replace' })
}

async function toggle($: EngineInterface, s: Suggestion, surface: RenderSurface): Promise<void> {
  const isPicked = (await read($, selected)).includes(s.name)
  await update($, selected, list => (isPicked ? list.filter(n => n !== s.name) : [...list, s.name]))
  await update($, isReviewed, () => true)

  if (!isPicked && s.install) {
    const copied = await $.ui.copy({ text: s.install.join('\n'), surface })
    $.ui.toast(
      `${s.name} is not installed. ${copied.isCopied ? 'Copied' : 'Run'}: ${s.install.join('  then  ')}`,
    )
  }
}

async function hide($: EngineInterface): Promise<void> {
  await update($, isHidden, () => true)
  await update($, isReviewed, () => true)
  await $.ui.close({ id: PANE })
}

async function reset($: EngineInterface): Promise<void> {
  await $.ui.close({ id: PANE })
  await update($, suggestions, () => [])
  await update($, selected, () => [])
  await update($, held, () => null)
  await update($, phase, () => 'typing' as Phase)
  await update($, isHidden, () => false)
  await update($, isReviewed, () => false)
}

export const register: Register = (on, options) => {
  mode = options.mode === 'live' ? 'live' : 'ask'
  isAiOn = options.aiRanking !== false
  model = typeof options.aiModel === 'string' && options.aiModel ? options.aiModel : 'haiku'

  on('session.start', async ($, e, next) => {
    const stored = await $.store.get('enabled')
    isEnabled = stored !== false
    await $.command.register({
      name: PLUGIN,
      description: 'Skill pills above the prompt: on, off, status, or the skills for a brief',
      argumentHint: '[on|off|<brief>]',
    })
    await reset($)

    return next(e)
  })

  on('command.run', { command: PLUGIN }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      isEnabled = arg === 'on'
      await $.store.set('enabled', isEnabled)
      await reset($)
      lastSignature = ''

      return { text: `Skill Suggest is ${arg}.` }
    }
    if (!isEnabled) return { text: 'Skill Suggest is off. Turn it on with /skill-suggest on.' }

    if (arg !== '') {
      await reset($)
      lastSignature = ''
      await onDraft($, e.args)
      const list = await read($, suggestions)
      const where =
        bandSurface || paneSurface
          ? 'Pick them above the prompt, or send the brief.'
          : 'Send the brief as a message and Claude will ask which of these to load.'

      return {
        text:
          (list.length > 0 ? `${list.length} skills fit that brief.\n${listText(list)}\n${where}` : 'No skills fit that brief.') +
          `\n\n${diagnostics(await $.session.surfaces())}`,
      }
    }

    const idx = await loadIndex($)
    const installed = idx.entries.filter(x => x.candidate.kind !== 'open-source').length
    const asks = mode === 'ask' ? 'asks which skills to load when you send a brief' : 'never holds a brief'

    return {
      text:
        `Skill Suggest is on: pills follow your draft, and it ${asks}` +
        `${isAiOn ? `, ranked by ${model}` : ''}. ` +
        `It knows ${installed} installed skills and ${CATALOG.length} open-source ones.\n` +
        diagnostics(await $.session.surfaces()),
    }
  })

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    editsSeen += 1
    await onDraft($, box.text)

    return box
  })

  on('prompt.change', async ($, e, next) => {
    if (e.origin.kind !== 'clear') await onDraft($, e.text)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!isEnabled || e.command || e.isMeta) return next(e)
    lastOrigin = e.origin.kind

    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (!isPerson) return next(e)

    const shouldHold =
      mode === 'ask' &&
      e.turnId === undefined &&
      !(await read($, isReviewed)) &&
      e.text.trim().split(/\s+/).length >= MIN_WORDS + 2 &&
      (await isWorthAsking($, e.text))

    // A plugin's own submission cannot carry the person's images, so a brief
    // with attachments is never held: Claude asks for the picks instead.
    const hasMedia = (e.attachments?.length ?? 0) > 0

    // A held brief must be on screen somewhere, or it would be lost.
    if (shouldHold && !hasMedia) await show($)
    if (shouldHold && !hasMedia && isSeen()) {
      isPaneDismissed = false
      await update($, held, () => e.text)
      await update($, phase, () => 'analysing' as Phase)
      await update($, isHidden, () => false)

      const picks = await analyse($, e.text)
      if (picks.length > 0) {
        await update($, suggestions, () => picks)
        await update($, selected, () =>
          picks.filter(s => s.match === 'strong' && s.kind !== 'open-source').map(s => s.name),
        )
        await update($, phase, () => 'held' as Phase)

        $.ui.toast('Skill Suggest wants your input: pick the skills to load, then Send')
        return { drop: 'Skill Suggest wants your input — pick the skills to load above, then press Send. Your brief is kept.' }
      }
      // Nothing fits: the brief goes through untouched.
    } else if (shouldHold) {
      // Nothing here can draw the pills: Claude asks instead, with its own
      // question card, which every surface shows.
      const picks = await analyse($, e.text)
      await reset($)
      lastSignature = ''
      if (picks.length === 0) return next(e)

      $.ui.toast(`Skill Suggest: ${picks.length} skills fit; Claude will ask which to load`)
      return next({ ...e, context: [...(e.context ?? []), askContext(picks)] })
    }

    const picked = await read($, selected)
    const list = await read($, suggestions)
    const chosen = list.filter(s => picked.includes(s.name))
    await reset($)
    lastSignature = ''

    const note = contextFor(chosen)
    if (!note) return next(e)

    $.ui.toast(`Loading skills: ${chosen.filter(s => !s.install).map(s => s.name).join(', ') || 'none'}`)
    return next({ ...e, context: [...(e.context ?? []), note] })
  }).catch(async ($, e, next) => {
    // Fail open: a brief is never lost to a failure here.
    await reset($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !isEnabled) return next(e)
    bandSurface = e.surface

    return (await picker($, e, e.props.bodyColumns)) ?? next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    paneSurface = e.surface
    const tree = await picker($, e, e.props.bodyColumns)
    if (tree) return tree

    const { Text } = $.ui.resolve(e)
    return <Text dimColor>No skill suggestions yet. Type a brief, or run /skill-suggest with one.</Text>
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') isPaneDismissed = true

    return next(e)
  })
}

// The suggestions as pills, for the band or the pane; null when there is
// nothing to show.
async function picker(
  $: EngineInterface,
  e: RenderInput<'AbovePrompt' | 'Pane'>,
  width: number,
): Promise<JSX.Element | null> {
    const now = await read($, phase)
    const list = await read($, suggestions)
    const picked = await read($, selected)
    const isWaiting = now !== 'typing'
    if (!isWaiting && (list.length === 0 || (await read($, isHidden)))) return null

    const { Box, Button, Text } = $.ui.resolve(e)

    if (now === 'analysing') {
      return <Text bold wrap="truncate">✦ Finding skills that fit your brief…</Text>
    }

    const groups: [string, Suggestion[]][] = [
      ['Installed · strong match', list.filter(s => !s.install && s.match === 'strong').slice(0, 4)],
      ['Installed · good match', list.filter(s => !s.install && s.match === 'good').slice(0, 3)],
      ['Not installed · open source (press to copy install)', list.filter(s => s.install).slice(0, 3)],
    ]

    let hotkey = 0
    const pill = (s: Suggestion) => {
      hotkey += 1
      const isPicked = picked.includes(s.name)
      const mark = isPicked ? '✓' : s.install ? '↓' : '+'
      const label = `${mark} ${shortName(s.name)}`
      const tag = tagOf(s)
      const room = Math.max(12, width - label.length - tag.length - 14)

      return (
        <Button
          key={`pill:${s.name}`}
          hotkey={hotkey < 10 ? String(hotkey) : undefined}
          onPress={() => toggle($, s, e.surface)}
        >
          {label}
          <Text dimColor> — {oneLine(s.reason ?? s.description, room)}</Text>
          <Text dimColor italic> · {tag}</Text>
        </Button>
      )
    }

    const count = picked.length
    const brief = await read($, held)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text bold wrap="truncate">
            {isWaiting ? '✦ Pick the skills to load for this brief, then send' : '✦ Skills for this brief'}
          </Text>
          {isWaiting ? null : (
            <Button key="hide" label="Hide" plain onPress={() => hide($)} />
          )}
        </Box>
        {brief === null ? null : (
          <Text dimColor wrap="truncate">“{oneLine(brief, Math.max(20, width - 4))}”</Text>
        )}
        {groups
          .filter(([, items]) => items.length > 0)
          .map(([title, items]) => (
            <Box key={`group:${title}`} flexDirection="column">
              <Text dimColor>{title}</Text>
              {items.map(pill)}
            </Box>
          ))}
        {isWaiting ? (
          <Box flexDirection="row" gap={1}>
            <Button
              key="send"
              variant="primary"
              label={count > 0 ? `Send with ${count} skill${count === 1 ? '' : 's'}` : 'Send'}
              onPress={() => sendHeld($, true)}
            />
            <Button key="send-plain" label="Send as is" onPress={() => sendHeld($, false)} />
            <Button key="edit" label="Edit brief" onPress={() => editHeld($)} />
          </Box>
        ) : (
          <Text dimColor wrap="truncate">
            {count > 0 ? `${count} picked · loads when you send` : 'Press a skill to load it with your message'}
          </Text>
        )}
      </Box>
    )
}

// The suggestions as plain lines, for surfaces that show text alone.
export function listText(list: readonly Suggestion[]): string {
  const groups: [string, Suggestion[]][] = [
    ['Installed · strong match', list.filter(s => !s.install && s.match === 'strong')],
    ['Installed · good match', list.filter(s => !s.install && s.match === 'good')],
    ['Not installed · open source', list.filter(s => s.install)],
  ]

  return groups
    .filter(([, items]) => items.length > 0)
    .map(([title, items]) =>
      [title, ...items.map(s => `  ${s.install ? '↓' : '+'} ${shortName(s.name)} — ${oneLine(s.description, 90)} (${tagOf(s)})`)].join('\n'),
    )
    .join('\n')
}

function tagOf(s: Suggestion): string {
  const prefix = s.name.includes(':') ? s.name.slice(0, s.name.indexOf(':')) : ''
  if (s.kind === 'plugin' && prefix) return prefix
  if (s.kind === 'open-source') return s.origin
  return TAG[s.kind]
}

// What the model reads where no pills can be drawn: one numbered list of
// skills to tick, then the next step, as the exact question card to put.
// The card takes four options a question, so the list holds three skills
// and All; a second list holds any more.
export function askContext(picks: readonly Suggestion[]): string {
  const ordered = [
    ...picks.filter(s => !s.install && s.match === 'strong'),
    ...picks.filter(s => !s.install && s.match === 'good'),
    ...picks.filter(s => s.install),
  ].slice(0, 7)
  const first = ordered.slice(0, 3)
  const more = ordered.slice(3)

  const tagOfMatch = (s: Suggestion) => (s.install ? 'not installed' : s.match === 'strong' ? 'mandatory' : 'suggested')
  const option = (s: Suggestion, n: number) => ({
    label: `${n}. ${shortName(s.name)} (${tagOfMatch(s)})`,
    description:
      `${oneLine(s.description, 100)} · ` +
      (s.install ? `not installed, from ${s.origin}` : `installed, ${tagOf(s)}`),
  })

  const questions = [
    {
      header: 'Skills',
      question: 'Which skills should I load for this brief?',
      multiSelect: true,
      options: [
        ...first.map((s, k) => option(s, k + 1)),
        { label: 'All', description: 'Load every skill in this list' },
      ],
    },
    ...(more.length > 0
      ? [
          {
            header: 'More',
            question: 'More skills that fit: tick any to load too.',
            multiSelect: true,
            options: [
              ...more.map((s, k) => option(s, k + 4)),
              ...(more.length === 1 ? [{ label: 'None', description: 'Load none of these' }] : []),
            ],
          },
        ]
      : []),
    {
      header: 'Next',
      question: 'How should I go on?',
      multiSelect: false,
      options: [
        { label: 'Pick only mandatory', description: 'Load just the (mandatory) skills, whatever is ticked' },
        { label: 'Skip', description: 'Load no skills and start on the brief' },
        { label: 'Next', description: 'Load the skills I ticked, then start on the brief' },
      ],
    },
  ]

  const names = ordered.map(
    (s, k) =>
      `- ${k + 1}. ${shortName(s.name)} = \`${s.name}\` (${tagOfMatch(s)})` +
      (s.install ? `, install: ${s.install.join(' then ')}` : ''),
  )

  return [
    'The skill-suggest plugin ranked skills for this request. Before any other tool call or any of the work, ' +
      'call the AskUserQuestion tool with exactly these questions:',
    JSON.stringify({ questions }),
    'Then act on the "Next" answer. "Next": load each ticked skill (All means every skill listed). ' +
      '"Pick only mandatory": load every (mandatory) skill, whatever was ticked. "Skip": load none. ' +
      'Load installed skills with the Skill tool; for a ticked (not installed) skill, give its install commands ' +
      'and carry on without it. Then do the request. If the person answers in their own words instead, or the ' +
      'message is about this card or the skill-suggest plugin itself, follow their words and skip the card.',
    'Full names for the Skill tool:',
    ...names,
  ].join('\n')
}

// What the model reads beside the brief: the skills to load, and the
// open-source ones the person flagged but has not installed.
export function contextFor(chosen: readonly Suggestion[]): string | null {
  const load = chosen.filter(s => !s.install)
  const missing = chosen.filter(s => s.install)
  if (load.length === 0 && missing.length === 0) return null

  const lines: string[] = []
  if (load.length > 0) {
    lines.push(
      'Pick these skills for the request: before you start, load each one with the Skill tool ' +
        'and follow it: ' +
        load.map(s => `\`${s.name}\``).join(', ') +
        '.',
    )
  }
  if (missing.length > 0) {
    lines.push(
      'They also flagged these open-source skills, which are not installed, so do not invoke them; ' +
        'if they would help, tell the person how to install them: ' +
        missing.map(s => `${s.name} (${(s.install ?? []).join(' then ')})`).join('; ') +
        '.',
    )
  }

  return lines.join('\n')
}

async function inventory($: EngineInterface): Promise<Candidate[]> {
  const commands = (await $.command.list()).filter(c => c.plugin !== PLUGIN && c.name !== PLUGIN)

  let listing: { name: string; source: string; pluginName?: string }[] = []
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    listing = [...(usage.context.breakdown?.skills?.skillFrontmatter ?? [])]
  } catch {
    listing = []
  }

  if (listing.length === 0) {
    return commands
      .filter(c => !(c.source === 'builtin' && UTILITY.has(c.name)))
      .map(c => ({ name: c.name, description: c.description, kind: kindOfCommand(c), origin: c.plugin ?? '' }))
  }

  const byName = new Map(commands.map(c => [c.name, c]))
  return listing
    .filter(s => s.name !== PLUGIN)
    .map(s => {
      const command = byName.get(s.name) ?? commands.find(c => shortName(c.name) === shortName(s.name))
      return {
        name: s.name,
        description: command?.description ?? '',
        kind: kindOfSkill(s.source, s.pluginName ?? command?.plugin),
        origin: s.pluginName ?? command?.plugin ?? '',
      }
    })
}

function kindOfSkill(source: string, plugin?: string): SkillKind {
  switch (source) {
    case 'userSettings':
    case 'syncedSkills':
      return 'yours'
    case 'projectSettings':
      return 'project'
    case 'policySettings':
      return 'org'
    case 'built-in':
      return 'builtin'
    case 'mcp':
      return 'mcp'
    default:
      return plugin && /anthropic/i.test(plugin) ? 'anthropic' : 'plugin'
  }
}

function kindOfCommand(c: CommandInfo): SkillKind {
  if (c.source === 'user') return 'yours'
  if (c.source === 'builtin') return 'builtin'
  if (c.source === 'mcp') return 'mcp'
  return c.plugin && /anthropic/i.test(c.plugin) ? 'anthropic' : 'plugin'
}
