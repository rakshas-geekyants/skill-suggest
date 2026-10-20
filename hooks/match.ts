// Keyword matching between a brief and skill descriptions. Cheap enough to
// run on every edit of the prompt box.

import type { Candidate, Match, Suggestion } from '../types'

const STOPWORDS = new Set(
  (
    'a an the and or but if then so of in on at by to for from with into via about as is are be been ' +
    'was were do does did done have has had i me my we our you your it its this that these those there ' +
    'here what which who how why where when whenever while can could would should will shall may might ' +
    'must need needs want wants wanted please help also any all some such than very just like get got ' +
    'etc not no yes up out more most other own same each every one two new use uses using used user ' +
    'users claude should able make makes making thing things way something anything'
  ).split(' '),
)

// Brief words that imply a skill's vocabulary without sharing it.
const SYNONYMS: Record<string, readonly string[]> = {
  slide: ['pptx', 'presentation', 'deck'],
  deck: ['pptx', 'presentation', 'slide'],
  presentation: ['pptx', 'slide'],
  powerpoint: ['pptx', 'presentation'],
  keynote: ['pptx', 'presentation'],
  spreadsheet: ['xlsx', 'excel'],
  excel: ['xlsx', 'spreadsheet'],
  sheet: ['xlsx', 'spreadsheet'],
  csv: ['xlsx', 'spreadsheet'],
  word: ['docx'],
  bug: ['debug', 'error', 'fix'],
  error: ['debug', 'bug'],
  crash: ['debug', 'bug', 'error'],
  broken: ['debug', 'bug'],
  fail: ['debug', 'test', 'failure'],
  failure: ['debug', 'test'],
  exception: ['debug', 'error'],
  test: ['testing', 'tdd'],
  tdd: ['test'],
  plan: ['planning', 'implementation'],
  roadmap: ['plan'],
  requirement: ['spec', 'plan'],
  idea: ['brainstorm', 'design'],
  brainstorm: ['idea', 'design'],
  ui: ['frontend', 'interface', 'design'],
  ux: ['frontend', 'design', 'usability'],
  website: ['web', 'frontend', 'page'],
  landing: ['web', 'page', 'frontend'],
  webpage: ['web', 'page', 'frontend'],
  dashboard: ['frontend', 'ui', 'chart'],
  component: ['frontend', 'ui'],
  poster: ['design', 'visual', 'art'],
  logo: ['design', 'brand', 'visual'],
  illustration: ['art', 'visual', 'design'],
  gif: ['animated', 'animation'],
  animation: ['animated', 'motion', 'gif'],
  llm: ['api', 'claude-api', 'model'],
  sdk: ['api'],
  agent: ['api', 'llm', 'subagent'],
  mcp: ['server', 'protocol'],
  connector: ['mcp', 'integration'],
  integration: ['mcp', 'api'],
  pr: ['review', 'merge', 'branch'],
  review: ['feedback', 'critique'],
  merge: ['branch', 'git'],
  worktree: ['git', 'branch'],
  email: ['newsletter', 'comms', 'communication'],
  newsletter: ['email', 'comms'],
  announcement: ['comms', 'communication', 'update'],
  memo: ['comms', 'communication'],
  status: ['report', 'update'],
  blog: ['content', 'post', 'marketing'],
  campaign: ['marketing', 'launch'],
  seo: ['keyword', 'search', 'marketing'],
  copy: ['copywriting', 'content'],
  brand: ['guideline', 'style'],
  a11y: ['accessibility', 'wcag'],
  accessibility: ['a11y', 'wcag'],
  interview: ['research', 'user'],
  survey: ['research'],
  figma: ['design', 'figma'],
  mockup: ['design', 'figma', 'prototype'],
  prototype: ['design', 'mockup'],
  diagram: ['flowchart', 'diagram'],
  flowchart: ['diagram'],
  chart: ['visualization', 'graph', 'dataviz'],
  graph: ['chart', 'visualization'],
  doc: ['document', 'docs'],
  spec: ['document', 'plan', 'requirement'],
}

// A light stemmer: enough to make "slides" meet "slide" and "testing" meet
// "test", applied to both sides alike.
export function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ies')) return word.slice(0, -3) + 'y'
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3)
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2)
  if (word.length > 4 && word.endsWith('es') && !word.endsWith('ses')) return word.slice(0, -1)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9][a-z0-9+#]*/g) ?? []

  return words.filter(w => w.length > 1 && !STOPWORDS.has(w)).map(stem)
}

function briefTerms(brief: string): Set<string> {
  const terms = new Set<string>()
  for (const token of tokenize(brief)) {
    terms.add(token)
    for (const extra of SYNONYMS[token] ?? []) terms.add(stem(extra))
  }

  return terms
}

type Entry = {
  candidate: Candidate
  nameTerms: Set<string>
  terms: Set<string>
}

export type Index = {
  entries: Entry[]
  idf: Map<string, number>
}

// The part after a plugin's prefix: `anthropic-skills:pdf` is `pdf`.
export function shortName(name: string): string {
  return name.slice(name.lastIndexOf(':') + 1)
}

export function buildIndex(candidates: readonly Candidate[]): Index {
  const entries = candidates.map(candidate => {
    const nameTerms = new Set(tokenize(shortName(candidate.name).replace(/[-_]/g, ' ')))
    nameTerms.add(stem(shortName(candidate.name).toLowerCase()))
    const terms = new Set([...nameTerms, ...tokenize(candidate.description)])

    return { candidate, nameTerms, terms }
  })

  const df = new Map<string, number>()
  for (const entry of entries) {
    for (const term of entry.terms) df.set(term, (df.get(term) ?? 0) + 1)
  }
  const idf = new Map<string, number>()
  for (const [term, count] of df) {
    idf.set(term, Math.log((entries.length + 1) / (count + 0.5)))
  }

  return { entries, idf }
}

export const STRONG = 7
export const GOOD = 3.5

export function matchOf(score: number): Match | null {
  if (score >= STRONG) return 'strong'
  if (score >= GOOD) return 'good'
  return null
}

export function score(index: Index, entry: Entry, terms: Set<string>, brief: string): number {
  let total = 0
  for (const term of terms) {
    if (!entry.terms.has(term)) continue
    const weight = index.idf.get(term) ?? 0
    total += entry.nameTerms.has(term) ? weight * 2.5 : weight
  }

  // Naming the skill outright ("use pdf", "/pdf") is the strongest signal.
  const name = shortName(entry.candidate.name).toLowerCase()
  const lower = brief.toLowerCase()
  if (name.length > 2 && new RegExp(`(^|[^a-z0-9-])/?${escape(name)}([^a-z0-9-]|$)`).test(lower)) {
    total += STRONG
  }

  return total
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The best matches for a brief. An open-source skill is left out when an
// installed one carries the same short name.
export function rank(index: Index, brief: string, limit = 8): Suggestion[] {
  const terms = briefTerms(brief)
  if (terms.size === 0) return []

  const installed = new Set(
    index.entries
      .filter(e => e.candidate.kind !== 'open-source')
      .map(e => shortName(e.candidate.name)),
  )

  const scored: Suggestion[] = []
  for (const entry of index.entries) {
    const { candidate } = entry
    if (candidate.kind === 'open-source' && installed.has(candidate.name)) continue
    const value = score(index, entry, terms, brief)
    const match = matchOf(value)
    if (match) scored.push({ ...candidate, match, score: Math.round(value * 10) / 10 })
  }

  scored.sort((a, b) => b.score - a.score)

  // Grade against the best match too, so one clear winner is not crowded
  // by skills that share a single common word with the brief.
  const top = scored[0]?.score ?? 0

  return scored
    .filter(s => s.score >= top * 0.25)
    .map(s => (s.match === 'strong' && s.score < top * 0.5 ? { ...s, match: 'good' as const } : s))
    .slice(0, limit)
}
