// Where a skill comes from, as the band groups it.
export type SkillKind =
  | 'yours'
  | 'project'
  | 'org'
  | 'anthropic'
  | 'plugin'
  | 'builtin'
  | 'mcp'
  | 'open-source'

// A skill the band can suggest: installed, or from the open-source catalog.
export type Candidate = {
  name: string
  description: string
  kind: SkillKind
  // The plugin, marketplace or repository it comes from, for the pill's tag.
  origin: string
  // Set for open-source skills: the slash commands that install it.
  install?: readonly string[]
}

export type Match = 'strong' | 'good'

export type Suggestion = Candidate & {
  match: Match
  score: number
  // Why it fits, when the model ranked it.
  reason?: string
}

// typing: suggestions follow the draft. analysing: the submitted brief is
// held while the model ranks skills. held: waiting for the person to pick.
export type Phase = 'typing' | 'analysing' | 'held'

declare module 'claude-code' {
  interface PluginState {
    'skill-suggest': {
      suggestions: Suggestion[]
      selected: string[]
      held: string | null
      phase: Phase
      isHidden: boolean
      isReviewed: boolean
    }
  }
}
