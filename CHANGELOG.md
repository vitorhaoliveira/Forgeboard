# Changelog

All notable changes to Forgeboard are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.9.1] — 2026-11-11

Review fixes: found by testing v1.9 with Claude Code.

### Fixed

- **Hawk can no longer run commands.** With Claude Code, plan mode didn't stop the reviewer from using the shell: in testing it ran `npm test`, which runs the repository's code even in **Restricted** mode. Hawk now runs without the shell and edit tools (`--disallowedTools`), so it can only read files, as documented.
- **Hawk knows what you said mid-run.** Your messages, answers and notes are now part of what Hawk reviews against. Before, a function you asked for with "Now" was flagged as "not requested" (scope creep).
- **"At the next pause" no longer costs a whole round.** A message sent while Forge works now reaches it right when its step ends, before the checks and the review. Before, it waited until after Hawk's review and then started a new round, so the checks and the review ran twice.

## [1.9.0] — 2026-11-11

Talk to the crew: a conversation instead of answer cards.

### Added

- **Conversation on the run screen.** Your task, the agents' messages, questions, decisions and reviews read as one thread, with a message box always at the bottom. A question is a normal message: reply by typing; the agent's options are small suggestions above the box. "Messages only" hides tool calls and checks.
- **Talk while the crew works.** A message sent while Forge works can interrupt its step ("Now"): Forgeboard stops it and resumes the same session with your message, for Claude Code and Codex. "At the next pause" waits for the step to end instead. During review, a message sends the work back as a note.
- **"Decide and tell me" mode** (workspace settings → Conversation and doubts). Forge goes with its best guess instead of stopping and lists what it decided; it only stops when a wrong guess would be destructive. The decisions show in the conversation and as a "To check" card on the desk ("Looks good" / "Correct…"), which doesn't block the task.
- Workspace settings for plans before big tasks, whether messages interrupt by default, and browser notifications when an agent needs you (per browser, only when Forgeboard isn't on screen).
- Desk question cards have a reply box right in the card, with suggestions and "Open conversation".
- API: `POST /api/tasks/:id/message` and `POST /api/tasks/:id/assumptions/ack`.

### Fixed

- The machine-readable line of forms (and of the new decisions list) no longer shows up in the agent's message when using Claude Code.

## [1.8.0] — 2026-11-10

Codex joins the crew.

### Added

- **Codex provider.** Any agent can run on OpenAI's Codex CLI (`codex exec --json`), using the CLI's own login (ChatGPT account or API key). Mix providers per agent in **Crew**, for example Claude Code builds and Codex reviews.
- Codex runs in its own sandbox: Hawk is read-only, Forge can only write inside the task's worktree. A workspace's **Standard** mode gives Forge network access (to install packages); **Restricted** turns it off.
- Codex's activity (commands, file changes, messages) shows in the live run like Claude's, and a paused run resumes the same Codex session after you answer.
- Settings shows whether Codex is installed and logged in, with install and login steps.
- `FORGEBOARD_CODEX_BIN` to point to a specific `codex` binary.

### Changed

- An agent CLI that is installed but logged out shows as "unavailable" (instead of "not found"), with the reason next to it.

## [1.7.1] — 2026-11-10

Security release.

### Added

- **Access key.** With `forgeboard`, every API call needs a key kept in `~/.forgeboard/access-key` (readable only by you). The terminal prints a link that signs the browser in (an HttpOnly cookie), and a browser without it sees a notice instead of your data. Scripts can send it as `Authorization: Bearer <key>`. Other people and programs on the machine can no longer use the API. `pnpm dev` runs without it.
- **What Forge may run, per workspace** (workspace settings → Safety). **Standard** keeps today's behavior (package managers and node, to install and test). **Restricted** lets Forge only edit files; Forgeboard still runs the checks and sends back failures. Use it for repositories you don't fully trust.
- **How to connect Claude** in Settings: install and login steps, open automatically when Claude Code isn't found.
- `SECURITY.md`: how to report a vulnerability, and what Forgeboard does and doesn't protect.
- Dependabot (weekly npm, monthly GitHub Actions) and CodeQL code scanning.

### Changed

- The "server down" notice no longer assumes `pnpm dev`.

## [1.7.0] — 2026-11-10

One-command install: `npx forgeboard`.

### Added

- **`forgeboard` npm package** (`packages/cli`). One command starts the API and the web app on a single port (default 4317) and opens the browser. Options: `--port`, `--data-dir`, `--no-open`, `--version`, `--help`.
- Friendly start-up checks: Node 22.13+ is required (built-in SQLite), a clear message when the port is taken, and a hint when Claude Code isn't installed (the Mock crew still works).
- The package ships a trimmed Next.js standalone build with its runtime packages included: about 4.4 MB to download, no dependencies to install.
- **CI** on every pull request and on `main`: typecheck, build the package and smoke-test the installed command.
- **Publish workflow**: pushing a `v*` tag publishes to npm through Trusted Publishing (no token, with provenance), after checking the tag matches the package version.
- MIT license.

### Changed

- The server's startup moved to `startServer()` (`apps/server/src/start.ts`), which can also serve the web app on the same port. `pnpm dev` works as before.
- README: install with `npx forgeboard`; running from source is now under "From source", plus a "Releasing" section.

### Security

- The local API only accepts requests for a local Host (blocks DNS rebinding), refuses changes from foreign origins, and requires a JSON body for every change. Before, any website open in the browser could send a simple cross-site POST to the API, for example to register a repository and start a task.

## [1.6.0] — 2026-11-10

Rich questions: agents ask with small forms and editable plans, rendered with [A2UI](https://a2ui.org/).

### Added

- **Questions with a form.** When Forge needs several decisions at once it sends one form instead of a chain of questions: single choice (with a suggested option), multiple choice, yes/no, and short text. Answer everything in one go and the run continues with the data.
- **Editable plan before building.** For tasks that touch several files or layers, Forge proposes a plan first. Uncheck, reorder (drag, or Alt+↑/↓), rewrite or add steps, leave a note, then approve, or ask for another plan. Small tasks still start right away.
- **Forgeboard's A2UI catalog** (`packages/shared/src/a2ui.ts`): the only components an agent can use (Column, Text, Choice, MultiChoice, Toggle, TextInput, StepList, Submit). The agent describes a form in a compact JSON; the server compiles it to A2UI v0.9 messages and validates them in strict mode. Anything outside the catalog is rejected and the question falls back to the text format. The browser renders the catalog with Forgeboard's own React components and validates again. No agent code runs in the browser.
- Form answers show as chips in the activity feed, with the note if there is one. "Remember as house rules" saves one rule per decision; plans are never saved as rules.
- The mock crew and the public demo ask with a form (pagination decisions) and an editable plan (user settings page).

### Changed

- `POST /api/tasks/:id/answer` accepts `data` (checked against the form the agent sent), `note` and `replan`.

## [1.5.0] — 2026-11-10

Public demo: try Forgeboard in the browser without installing anything.

### Added

- **Demo mode** (`NEXT_PUBLIC_FORGEBOARD_DEMO=1`, or `pnpm demo`). A simulated crew runs in the browser with three seeded workspaces and tasks in every state: a question waiting for an answer, work ready to merge, work with open concerns and merged runs. Answering, merging, sending back, discarding and starting new tasks all work, with realistic timing, in English and Brazilian Portuguese.
- **Replay** button on finished runs: plays the run again on the graph, timeline and activity feed (also in the regular app).
- Demo banner with a link to run Forgeboard locally.
- Instructions to publish the demo on Vercel.

### Changed

- The web client talks to the backend through a small transport interface (`subscribe` instead of a raw EventSource), so the demo and the local server share the same UI code.

## [1.1.0] — 2026-11-10

Workspaces: group the repositories of each project, with its own crew and house rules, and see everything that needs you in one place.

### Added

- **Workspaces.** A workspace holds one or more repositories, a name, a short description and a color. Create one from the sidebar's "+" with its repositories and crew in one step.
- **Sidebar with workspaces.** Each workspace is a tile with a counter of what's waiting for you; "All" sits on top.
- **"All" desk.** Every workspace at a glance (waiting, running, today's cost) and all questions and reviews grouped by workspace.
- **Workspace desk.** Filter by repository, see each repo's checks and status, the workspace's crew and its rules.
- **Own crew per workspace.** Use the default crew or tune agents just for one workspace; copy a crew from another workspace when creating one; reset an agent back to the default.
- **House rules at three levels.** General (every workspace), workspace (all its repos) and repository. Rules can be moved between levels.
- **Workspace settings.** Rename, recolor, add, move or remove repositories, edit checks per repo, archive or delete the workspace.
- **Destination picker.** The task bar chooses the repository the task runs in; it remembers the last one.
- **Runs** show the workspace and repository of each task and can be filtered by workspace.

### Changed

- **Crew** in the sidebar is now the default crew plus the general house rules.
- **Settings** lists workspaces (including archived ones) and the agents available on this machine; repository settings moved into each workspace.

### Migration

- Existing repositories move into a workspace named "Personal". Existing house rules become rules of their repository. Nothing is lost.

## [1.0.0] — 2026-11-10

Crew & review: Forgeboard goes from "one agent with a live log" to a small crew that builds, checks and reviews work before you merge it.

### Added

- **Build & Review flow.** Forge builds the task, the repository's checks run, Hawk reviews and sends work back until it approves or the round limit (3 by default) is reached. Then you decide.
- **Isolated git worktrees.** Every task runs on its own branch (`fb/<task>-<id>`) in `~/.forgeboard/worktrees`, so your checkout is untouched until you merge.
- **Agent questions.** Forge can pause a run to ask for a product decision. The question shows on the Desk with one-click answers, and the same Claude Code session resumes with your answer.
- **Checks.** Test, lint and type-check commands are detected from `package.json` and editable in Settings. Hawk can't approve while a check fails.
- **Merge decision screen.** Summary first (what changed, how we know it works, risk), then the diff. Leave files out of the merge, send the work back with notes, or discard it.
- **Crew.** Rename Forge and Hawk, pick a personality (mentor, balanced, strict), choose the provider and add instructions.
- **House rules.** Rules per repository that every agent follows. They come from your answers ("Remember as a house rule"), from Hawk's suggestions, or from you.
- **New UI.** Dark, minimal design with a Desk (what needs you, who is working), a live Run view (flow graph, timeline per agent, activity feed), Runs, Flows and Settings.
- **English (US) and Brazilian Portuguese.** Follows the browser language, switchable with the EN / PT button. Agents reply in the UI language; costs use the local format (US$ 0,58).
- **Mock crew.** A scripted crew that walks the whole flow (question, rejected review, fix, approval) with real file changes, for trying Forgeboard without spending tokens.

### Changed

- Forge may run package-manager commands (`npm`, `pnpm`, `yarn`, `bun`, `npx`, `node`) and read-only git/`ls` commands without approval; anything else is refused. Hawk is read only.
- Data is stored in `forgeboard-v1.db`. Tasks from v0 are not migrated.

### Removed

- The v0 single-agent task screen and its "read only / can edit files" toggle, replaced by worktrees and the review flow.

## [0.1.0] — 2026-11-10

### Added

- Local server (Hono + SQLite) and Next.js UI in a pnpm monorepo.
- Claude Code provider driving the CLI in headless stream-json mode, plus a mock provider.
- Live, resumable event stream over SSE; stop a running task; task history.
