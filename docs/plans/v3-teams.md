# v3 — Teams: a Lead, ready-made teams, any kind of work

Status: the Lead (Phase A) shipped in v2.2.0, teams and code templates in v2.3.0. Any kind of work (v2.4) is next.

## The idea in three lines

1. **A Lead** reads each task and recruits the teammates it needs (who makes, who reviews, whether checks run, where you get asked), instead of you picking a fixed flow every time.
2. **Teams** you build, or start from **ready-made templates**: a Lead plus members, each with a role, instructions and the AI that runs it.
3. **Any kind of work**, not only code: docs, research, content, data, translation, ops. If the work lives in files in a folder, a team can do it.

## Where we start (v2.1)

- Flows are data and run step by step (`runFlow`). Steps are builders, reviewers, checks and "Ask me" pauses. A flow is picked per task and checked by `validateFlow`.
- Agents have a role (`builder` / `reviewer`). The default crew can be copied into a workspace's own crew.
- Everything still assumes code:
  - a workspace holds **git repositories** (`repoRoot` must succeed);
  - the agent prompt says "working on a git repository" and talks about "product decisions… from the code" (`prompts.ts`);
  - checks are guessed from `package.json` (`checks.ts`);
  - builders may run package managers;
  - the last step is a **merge** into a branch.

## 1. The Lead

A new role, **lead**, next to maker (today's builder) and reviewer. A lead never edits files. It plans and decides.

### Phase A: the Lead plans the task's flow

```
your task → Lead (plans) → [the flow it chose: makers, checks, reviewers, pauses] → You
```

- The Lead gets the task, the team's roster (each member's name, role and instructions) and a short look at the folder (file list, README).
- It answers with a plan: the steps to run, each with one line on why. For example:
  - "Small bug: Forge, then checks."
  - "Public API change: Forge, checks, Hawk, then Guard for security, then a pause before docs."
- The plan is a regular `Flow`, so it goes through `validateFlow`, limited to the team's members, and runs on the existing engine.
- **Approval** follows the workspace's ask mode:
  - *Ask first*: the plan shows as an editable card (like today's editable plan). You can remove, reorder or add steps, then approve.
  - *Decide and tell me*: it runs right away and the plan shows in "To check".
- The run graph starts with a **Lead** node; the chosen steps appear after it once the plan exists.
- Cost: one extra agent call per task. It can run on a cheaper model.

### Phase B: the Lead steps in at checkpoints (later)

The Lead is asked again only at a few points, with a hard limit (two re-plans per task):

- a reviewer used all its rounds and still requests changes: retry, bring in another member, or hand it to you;
- a maker asks a question the Lead can answer from the task and house rules. In *Decide and tell me* the Lead answers; otherwise it suggests an answer for you to confirm;
- your note at a pause changes the plan ("now also translate it").

A full supervisor that decides after every step stays out of scope. It costs a call per step and is hard to predict.

### Why not one Claude session with subagents

A single session that spawns subagents would hide each member from the graph, the timeline and the filters. It would also drop the role permissions: a reviewer could run commands again. The Lead only plans, and Forgeboard runs each member itself.

## 2. Teams and templates

A **team** replaces today's "crew":

```ts
interface Team {
  id: string;
  name: string;
  description: string;
  /** What this team works on, in words. It goes into every member's prompt (see §3). */
  context: string;
  members: Agent[];          // roles: lead (at most one), maker, reviewer
  /** "lead": the Lead plans each task. A flow id: always run that flow. */
  planning: "lead" | string;
  /** What makers may run: none, a preset (node, python…) or your own list. */
  commands: CommandPolicy;
  /** Checks to run when the plan has a checks step. Repos can still add their own. */
  checks: CheckCommand[];
  builtIn?: boolean;         // templates
}
```

- **Teams page** (replaces Crew). It shows your teams, plus **Start from a template**: a gallery where each card shows the roster, an example plan and example tasks. Picking a template makes your own copy, which you can edit freely.
- **Workspace → Team:** each workspace picks a team. The default crew and workspaces' own crews migrate into teams automatically, so nothing changes for current users.
- **Task bar:** each task can run with "Lead decides" or a fixed flow.

### Templates to ship

| Template | Lead | Makers | Reviewers | Checks / commands |
|---|---|---|---|---|
| **Build & Review** (today's default) | none | Forge | Hawk | repo checks · package managers |
| **Product team** (code) | Lead | Forge, Scribe (docs) | Hawk, Guard (security) | repo checks · package managers |
| **Quick fix** (code) | none | Forge | none | repo checks |
| **Docs** | Lead | Writer | Editor | markdown lint (optional) · none |
| **Content** (blog, marketing, emails) | Lead | Writer | Editor, Fact-checker | none |
| **Research brief** | Lead | Researcher | Fact-checker | none |
| **Data analysis** | Lead | Analyst | Reviewer | python/notebook · python |
| **Translation** | none | Translator | Native reviewer | none |

Each member of a template ships with instructions, a personality and a role. Example: the Fact-checker *"marks every claim without a source and every number that doesn't add up; never rewrites the text."*

## 3. Any kind of work

### Folders, not only git repositories

- A workspace holds **folders**. Git stays under the hood, because it powers isolation (worktrees), the diff and "discard".
- When you choose a folder that isn't a git repository (with the v2.1 folder picker), Forgeboard offers **"Start tracking this folder"**: one click runs `git init` and makes a first commit. Nothing else changes in your folder.
- Later option: a hidden repository under `~/.forgeboard/` (`GIT_DIR` / `GIT_WORK_TREE`), for folders where you don't want a `.git` at all.

### Words that fit the work

Labels follow the team's context, from a small set: code, writing, research, data, other.

| | Code | Writing / research / other |
|---|---|---|
| maker | builds | writes / produces |
| review screen | "Review and merge" | "Review and accept" |
| result | diff | rendered preview of changed documents (markdown, text), with the diff one click away |

The prompts drop the code-only wording:
- "working on a git repository" becomes "working in a folder of files for this team: {team.context}";
- "product decision… from the code" becomes "a decision you can't infer from the files and the task".

House rules work the same way: "Write in a friendly tone, no jargon" is as valid as "never use `any`".

### Permissions follow the team

- **Commands for makers:** `none` by default for non-code templates (they only edit files), presets for code and data, or your own list. This extends today's Standard/Restricted switch.
- **Reviewers** stay read-only everywhere (no shell, no edits), as in v2.0.1.
- **Checks** are optional and can be any command: `markdownlint`, `vale` for style, `python -m pytest`, or none.

## Data model and migration

- `AgentRole` gains `"lead"`. The Lead's plan uses a new marker, `FORGEBOARD_PLAN: {"steps": [...], "why": {...}}`, parsed into a `Flow`.
- New `teams` table, with migration 3 using `PRAGMA user_version`:
  - the default crew becomes the team "Default team", with planning set to Build & Review;
  - each workspace's own crew becomes "{workspace} team";
  - `Workspace.teamId` replaces `crewMode`.
- `Task` gains `teamId`, plus `plan` (the Lead's reasons per step, shown on the plan card). `Task.flow` stays the copy that actually runs.
- `Repo` becomes "folder" in the UI. The API name stays for compatibility.

## Phasing (each one usable on its own)

| Version | What | Why first |
|---|---|---|
| **v2.2 — Lead** | Lead role, plan card, "Lead decides" option, Lead node in the graph. Works with today's crews. | Biggest change in how it feels, smallest change in the model. |
| **v2.3 — Teams & templates** | Teams page, template gallery, migration from crews, team per workspace, commands and checks per team. | Makes "pick a ready-made team" possible. |
| **v2.4 — Any kind of work** | Folders without git ("Start tracking"), labels and prompts by context, document preview on the review screen, non-code templates. | Opens Forgeboard to docs, research, content and data. |
| v2.5+ | Lead checkpoints (Phase B), drag-and-drop canvas, parallel steps. | Builds on the above. |

## Risks

- **The Lead picks a poor plan.** The plan is validated, limited to the team, shown with its reasons and editable in *Ask first*. Every built-in template also works without a Lead.
- **Cost and latency.** One extra call per task. The Lead can run on a cheaper model, and a template can turn it off.
- **Quality outside code.** There are no tests to lean on there, so reviewers and their checklists matter more. Templates ship with strict reviewer instructions, and the document preview makes it fast for you to check.
- **Safety.** Non-code teams run no commands by default. A folder that wasn't a repository is only initialized when you click.

## Decisions for you

1. **Order:** Lead first (v2.2), as proposed, or teams and templates first?
2. **Name in Portuguese:** "Equipe" (as today) or "Time"?
3. **May the Lead answer a maker's questions** in *Decide and tell me* (Phase B), or should questions always come to you?
4. **Templates:** is this first set right? Anything missing for your own use?
5. **Folders without git:** is "Start tracking this folder" (creates a `.git`) fine, or do you need the hidden-repository option from the start?
