// Ranking skills with a small model once a brief is submitted. The keyword
// match stays the answer whenever the model's reply cannot be used.

import type { Candidate, Suggestion } from '../types'
import { shortName } from './match'

const RULES =
  'You pick which Claude skills fit a request. Below is the catalog, one per line as ' +
  '`name | kind | description`. Kind `open-source` means not installed yet.\n' +
  'Reply with JSON only: an array of at most 6 objects ' +
  '{"name": <exact name from the catalog>, "match": "strong" | "good", "reason": <under 12 words>}, ' +
  'best first. "strong": the request clearly needs it. "good": likely helpful. ' +
  'Leave out anything merely related. Prefer an installed skill over an open-source one ' +
  'that does the same job. Reply [] when nothing fits.\n\nCatalog:\n'

export function catalogText(candidates: readonly Candidate[]): string {
  return candidates
    .map(c => `${c.name} | ${c.kind} | ${oneLine(c.description, 160)}`)
    .join('\n')
}

export function briefText(brief: string): string {
  return `\n\nRequest:\n<<<\n${brief.slice(0, 6000)}\n>>>`
}

export const rules = RULES

type Pick = { name?: unknown; match?: unknown; reason?: unknown }

// Reads the model's reply into suggestions; null when it is not usable.
export function parsePicks(text: string, candidates: readonly Candidate[]): Suggestion[] | null {
  const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)
  if (!json) return null

  let picks: unknown
  try {
    picks = JSON.parse(json)
  } catch {
    return null
  }
  if (!Array.isArray(picks)) return null

  const byName = new Map(candidates.map(c => [c.name, c]))
  const byShort = new Map(candidates.map(c => [shortName(c.name), c]))
  const seen = new Set<string>()
  const out: Suggestion[] = []

  for (const pick of picks as Pick[]) {
    if (typeof pick?.name !== 'string') continue
    const candidate = byName.get(pick.name) ?? byShort.get(shortName(pick.name))
    if (!candidate || seen.has(candidate.name)) continue
    seen.add(candidate.name)
    const match = pick.match === 'strong' ? 'strong' : 'good'
    const reason = typeof pick.reason === 'string' ? oneLine(pick.reason, 90) : undefined
    out.push({ ...candidate, match, score: match === 'strong' ? 10 : 5, reason })
  }

  return out.slice(0, 6)
}

export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat
}
