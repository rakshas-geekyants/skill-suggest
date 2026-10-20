# Skill Suggest

A Claude Code plugin that tells you which skills to load for a brief, so you don't have to know or remember them.

- **While you type**, skills that match your brief show up as pills above the prompt.
- **When you press Enter**, it reads the brief again (with a small model), holds it, and asks which skills to load. Then it sends.
- **Every pill shows the skill's name and a one-line description**, grouped by where the skill comes from and how well it matches:

```
✦ Pick the skills to load for this brief, then send
“Build a pitch deck for our Series A with ten slides and a revenue chart”
Installed · strong match
 [ 1: ✓ pptx — Create and edit slide decks and presentations · Anthropic ]
 [ 2: + dataviz — Charts, graphs and dashboards · yours ]
Installed · good match
 [ 3: + theme-factory — Style slides and docs with a theme · plugin ]
Not installed · open source (press to copy install)
 [ 4: ↓ canvas-design — Posters and static visual design · anthropics/skills ]
[ Send with 1 skill ]  [ Send as is ]  [ Edit brief ]
```

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install skill-suggest --marketplace rakshas-geekyants/skill-suggest
```

Answer `y` to add the marketplace, then choose a scope (user scope turns it on in every session).

From a shell:

```
claude plugin install skill-suggest --marketplace rakshas-geekyants/skill-suggest
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `rakshas-geekyants/skill-suggest`, then **Add plugin**.

## How it works

| Moment | What happens |
| --- | --- |
| Typing | Each edit is matched against every installed skill and an open-source catalog. Matching uses keywords, weighted so rare words count more. It runs locally, makes no model calls and costs nothing. Matching skills show as pills. Press one (or its number key once the band has focus) to pick it. |
| Enter (`ask` mode) | If you haven't touched the pills yet, the brief is held and a small model (`haiku` by default) ranks the skills for it. Strong installed matches come pre-ticked. **Send with N skills**, **Send as is** or **Edit brief**. If nothing fits, the brief goes straight through. |
| Sent | Claude is told to load the picked skills with the Skill tool before it starts. |

Pill groups:

- **Installed · strong / good match**. These are skills you can load now. The tag says where each one comes from: `yours` (your own `~/.claude/skills`), `project`, `org`, `Anthropic`, a plugin's name, `built-in` or `MCP`.
- **Not installed · open source**. These are skills from [anthropics/skills](https://github.com/anthropics/skills) and [obra/superpowers](https://github.com/obra/superpowers). Pressing one copies its install commands to your clipboard. If you pick it, Claude is told how to install it instead of trying to run it.

Short replies like "yes" or "continue", slash commands, prompts typed while Claude is working, and prompts from other sessions or the SDK are never held.

## Commands

| Command | Does |
| --- | --- |
| `/skill-suggest` | Shows status: mode, model, and how many skills it knows |
| `/skill-suggest <brief>` | Shows the pills for a brief without sending it |
| `/skill-suggest off` / `on` | Turns it off or on, remembered across sessions |

**Hide** on the band hides it for the current draft.

## Settings

Open `/config` and look for the rows under **skill-suggest**:

| Setting | Default | |
| --- | --- | --- |
| `mode` | `ask` | `ask` holds a submitted brief until you pick. `live` never holds and only attaches what you picked while typing. |
| `aiRanking` | `true` | Rank with a model on Enter. Off means keyword matching alone. |
| `aiModel` | `haiku` | Model alias or id used for ranking. |

## Where it draws

- **Terminal and desktop app (local session):** pills appear in the band above the prompt.
- **Where no band is drawn:** the same pills open in a **Skill suggestions** pane.
- **Where neither is drawn** (for example, a cloud session viewed from the Claude app): the brief is not held. The plugin passes its ranked skills to Claude, which asks before doing any work, in a question card:
  - **Skills**: one numbered list with tick boxes, such as `1. design-blog-writer (mandatory)`, `2. docs (mandatory)`, `3. figma-use (suggested)`, then **All**. Skills you don't have yet are labelled `(not installed)`. Past three skills, a second list holds the rest, because the card takes four options a question.
  - **Next**: **Pick only mandatory**, **Skip** (load none) or **Next** (load what you ticked).

`/skill-suggest` prints a diagnostics line. It shows the surfaces attached, whether the band or pane was drawn, how many typing edits the plugin saw, and where the last prompt came from.

## Adding open-source skills to the catalog

Edit `hooks/catalog.ts`. Each entry is a name, a one-line description, the source repository and the slash commands that install it.

## Development

```
claude --plugin-dir ./           # run it from this folder
claude plugin validate .         # check the manifest and hooks module
claude plugin test .             # run tests/*.test.tsx
```

## License

MIT
