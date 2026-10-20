// Open-source skills worth suggesting when they are not installed yet.
// Each entry names the plugin that ships it and the commands that install it.

export type CatalogSkill = {
  name: string
  description: string
  source: string
  // Slash commands to run in order, one per line.
  install: readonly string[]
}

const ANTHROPIC_DOCS = {
  source: 'anthropics/skills',
  install: ['/plugin marketplace add anthropics/skills', '/plugin install document-skills@anthropic-agent-skills'],
}

const ANTHROPIC_EXAMPLES = {
  source: 'anthropics/skills',
  install: ['/plugin marketplace add anthropics/skills', '/plugin install example-skills@anthropic-agent-skills'],
}

const SUPERPOWERS = {
  source: 'obra/superpowers',
  install: ['/plugin install superpowers@claude-plugins-official'],
}

export const CATALOG: readonly CatalogSkill[] = [
  { name: 'pdf', description: 'Read, extract, merge, split, fill and create PDF files', ...ANTHROPIC_DOCS },
  { name: 'docx', description: 'Create and edit Word documents with formatting and tracked changes', ...ANTHROPIC_DOCS },
  { name: 'xlsx', description: 'Build and clean Excel spreadsheets and CSV files with formulas and charts', ...ANTHROPIC_DOCS },
  { name: 'pptx', description: 'Create and edit PowerPoint slide decks and presentations', ...ANTHROPIC_DOCS },
  { name: 'algorithmic-art', description: 'Generative art with p5.js: flow fields, particles, seeded randomness', ...ANTHROPIC_EXAMPLES },
  { name: 'brand-guidelines', description: 'Apply brand colors, typography and style guidelines to artifacts', ...ANTHROPIC_EXAMPLES },
  { name: 'canvas-design', description: 'Design posters, visual art and static graphics as PNG or PDF', ...ANTHROPIC_EXAMPLES },
  { name: 'doc-coauthoring', description: 'Co-write docs, proposals, technical specs and decision docs step by step', ...ANTHROPIC_EXAMPLES },
  { name: 'frontend-design', description: 'Distinctive UI and web page design: layout, typography, aesthetic direction', ...ANTHROPIC_EXAMPLES },
  { name: 'internal-comms', description: 'Write status reports, leadership updates, newsletters and FAQs', ...ANTHROPIC_EXAMPLES },
  { name: 'mcp-builder', description: 'Build MCP servers that connect Claude to external APIs and services', ...ANTHROPIC_EXAMPLES },
  { name: 'skill-creator', description: 'Create, improve and evaluate Claude skills', ...ANTHROPIC_EXAMPLES },
  { name: 'slack-gif-creator', description: 'Make animated GIFs sized and tuned for Slack', ...ANTHROPIC_EXAMPLES },
  { name: 'theme-factory', description: 'Style slides, docs, reports and landing pages with ready-made themes', ...ANTHROPIC_EXAMPLES },
  { name: 'web-artifacts-builder', description: 'Multi-component HTML artifacts with React, Tailwind and shadcn/ui', ...ANTHROPIC_EXAMPLES },
  { name: 'webapp-testing', description: 'Test local web apps with Playwright: screenshots, logs, UI checks', ...ANTHROPIC_EXAMPLES },
  {
    name: 'claude-api',
    description: 'Build LLM apps with the Claude API and SDKs: tools, caching, agents',
    source: 'anthropics/skills',
    install: ['/plugin marketplace add anthropics/skills', '/plugin install claude-api@anthropic-agent-skills'],
  },
  { name: 'brainstorming', description: 'Shape a rough idea into a design through guided questions before building', ...SUPERPOWERS },
  { name: 'writing-plans', description: 'Turn a spec or requirements into a step-by-step implementation plan', ...SUPERPOWERS },
  { name: 'executing-plans', description: 'Work through an implementation plan task by task with checkpoints', ...SUPERPOWERS },
  { name: 'test-driven-development', description: 'Write the failing test first, then the code, for features and bug fixes', ...SUPERPOWERS },
  { name: 'systematic-debugging', description: 'Find the root cause of bugs, errors and test failures before fixing', ...SUPERPOWERS },
  { name: 'verification-before-completion', description: 'Run the checks and show evidence before calling work done', ...SUPERPOWERS },
  { name: 'requesting-code-review', description: 'Get a review of a feature or branch before merging', ...SUPERPOWERS },
  { name: 'receiving-code-review', description: 'Act on code review feedback with rigor, not blind agreement', ...SUPERPOWERS },
  { name: 'using-git-worktrees', description: 'Isolate feature work in a git worktree', ...SUPERPOWERS },
  { name: 'dispatching-parallel-agents', description: 'Split independent tasks across parallel subagents', ...SUPERPOWERS },
  { name: 'subagent-driven-development', description: 'Execute a plan with a fresh subagent per task and reviews between', ...SUPERPOWERS },
  { name: 'finishing-a-development-branch', description: 'Wrap up a branch: tests, merge or PR, cleanup', ...SUPERPOWERS },
  { name: 'writing-skills', description: 'Write and test new skills before deploying them', ...SUPERPOWERS },
]
