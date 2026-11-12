# Changelog

All notable changes to Forgeboard are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- **Demo:** a new **Help center** workspace run by the ready-made **Docs** team. The Lead plans each task, steps in when the Editor's review gets stuck (new steps appear in the graph), and suggests an answer to the Writer's question with **Use this answer**. The guide shows rendered on the review screen, with **Accept**. New tasks in that workspace run Lead → Writer → Editor.
- **README:** new screenshots of the current interface (desk, forms, plan, run, decision, the Lead's plan and checkpoint, the Lead's suggestion, document preview, team gallery) and a new demo GIF.

## [2.5.0] — 2026-11-12

Lead checkpoints: the Lead steps in when a task gets stuck, a builder asks, or you change course.

### Added

- **When a review gets stuck.** In a task the Lead planned, a reviewer that still asks for changes after its last round no longer goes straight to you: the Lead decides between **one more round**, **new steps** (for example another builder, or a different reviewer) or **handing it to you**, with a line on why.
- **When a builder asks.** The Lead reads a builder's plain question with the task, the house rules and what you said:
  - in *Decide and tell me*, when it is sure, it answers and the builder goes on;
  - otherwise the question comes to you with **the Lead's suggestion** and a "Use this answer" button.

  Forms and plans always come to you.
- **When you change course at a pause.** An "Ask me" pause in a task the Lead planned has **Send to the Lead** next to "Send to the builder": the Lead plans the next steps for your note ("now also translate it"), or says the planned steps already cover it.
- The run shows each decision in the conversation, and new steps appear in the graph.
- Limits, so a task can't loop: at most 2 mid-task decisions and 3 answers by the Lead per task.
- API: `replan: true` on an answer to an "Ask me" pause sends the note to the Lead; new run event `checkpoint`; `leadAnswer` on questions.

## [2.4.0] — 2026-11-12

Any kind of work: teams for docs, content, research, data and translation, in any folder.

### Added

- **Any folder, not only git repositories.** In "Choose folder…", a plain folder shows **Start tracking this folder**: one click runs `git init` and saves a first snapshot of what is there (a hidden `.git` folder; nothing else changes). Git stays under the hood for each task's own copy, the list of changes and "discard".
- **Ready-made teams for other work**, in a new "For other work" group of the gallery:
  - **Docs**: Lead, Writer and Editor;
  - **Content**: Lead, Writer, Editor and Fact-checker;
  - **Research brief**: Lead, Researcher and Fact-checker;
  - **Data analysis**: Lead, Analyst and Reviewer (may run Python);
  - **Translation**: Lead, Translator and Native reviewer.
- **What a team works on** (Teams → a team): code, writing, research, data or other, plus a few words about the team that every member is told on every task.
- **What a team's builders may run**: files only, or files and commands. A workspace set to Restricted still wins. Data teams in "files and commands" may also run Python (`python`, `pip`, `uv`, `jupyter`).
- **Document preview on the review screen.** Changed markdown and text files open rendered, with their changes one click away. Outside code, the first documents open right away.
- API: `POST /api/folders/track`; `kind`, `about` and `commands` on teams; `preview` on changed documents in `GET /api/tasks/:id/diff`.

### Changed

- Outside code, agents are told they work in a folder of files (not a git repository), questions are about "the files and the task" instead of "the code", and the words follow: **Accept** instead of Merge, "Review & accept", "Accepted".
- "Repositories" are now **folders** in the UI.
- When git has no name and email set up on this machine, Forgeboard's own commits use "Forgeboard" instead of failing.

## [2.3.0] — 2026-11-11

Teams: build your own or start from a ready-made one.

### Added

- **Teams** (the Crew page is now Teams). Next to the default team, make your own teams: a name, a description, the flow its tasks run by default, and its members (any agent, with any role).
- **Ready-made teams** to start from, each with members, instructions in English and Portuguese, a default flow and example tasks:
  - **Build & Review**: Forge and Hawk;
  - **Product team**: Lead, Forge, Scribe (docs), Hawk and Guard (security);
  - **Quick fix**: Lead and Forge, no review round;
  - **Tests first**: Lead, Probe (writes the tests), Forge and Hawk.

  Picking one makes your own copy to change freely. A blank team starts as a copy of the default team.
- **A workspace can use one of your teams** (workspace settings → Team, or "A team" when you create a workspace, where ready-made teams can be picked directly). Its agents, its Lead and its default flow then come from that team; the Lead only picks among the team's members.
- API: `GET/POST /api/teams`, `PATCH/DELETE /api/teams/:id`, `POST /api/teams/:id/agents`, `PATCH/DELETE /api/teams/:id/agents/:agentId`; `teamId` on workspaces.

### Changed

- In Portuguese, "Equipe" is now "Time" everywhere.
- The workspace desk shows the team's name, and agents running on Codex are labeled Codex (they showed as Claude Code).

## [2.2.0] — 2026-11-11

The Lead: picks the team for each task.

### Added

- **Lead decides** (a new built-in flow). The Lead reads the task, the team and the repository's checks, and plans who works on it: which agent builds, whether the checks run, who reviews and who a reviewer sends work back to, and where you get a pause. Each step comes with one line on why.
- **You approve the plan** in "Ask first": it shows on the desk and in the conversation, step by step. Approve it, or write what to change ("it's trivial, skip the review") and the Lead plans again. In "Decide and tell me" the plan runs right away and stays in the conversation.
- The Lead is a built-in agent in **Crew** (name, AI, personality and instructions are editable). Like a reviewer, it only reads: no shell and no edits. It can plan with any agent of the workspace's crew or the default crew, including the ones you created.
- The run graph starts with the Lead and grows with the steps it picked; the timeline gets a Lead lane.
- A plan that can't run (unknown agent, a reviewer first…) falls back to Build & Review, and says so.

## [2.1.0] — 2026-11-11

Pick repositories from your folders.

### Added

- **Choose a repository from your folders.** "Choose folder…" (new workspace, workspace settings, and an empty workspace's desk) opens a folder browser: home, up, a clickable path, and git repositories marked, with the ones already added flagged. Typing the path still works.
- API: `GET /api/folders?path=` lists a folder's subfolders (your home by default; names only, hidden folders left out).

## [2.0.1] — 2026-11-11

Flow fixes: own crews, repeated agents, loop labels.

### Fixed

- **Flows run in workspaces with their own crew.** A workspace with its own crew uses its copy of each agent; agents it doesn't have come from the default crew. Before, a flow with an agent created after the workspace got its own crew (e.g. Scribe) was refused when you started a task.
- **The same agent twice in a flow.** Hand-backs now name the steps they come from and go to, so with Hawk reviewing twice, the right loop lights up and the right steps reset.
- **Loop labels show the current round only.** "2 issues → Forge" no longer stays on the graph after a later round that started from your note, a pause or a message.
- Texts that named Forge now name the agent they mean: where your review note goes ("sends the work back to Scribe"), the send-back placeholder, and "reaches the builder at its next step". The safety note talks about agents that build and review.

## [2.0.0] — 2026-11-11

Flow studio: your own flows and your own agents.

### Added

- **Your own flows** (Flows). A flow is the list of steps a task goes through before it gets to you. Build it as a list, with a live preview of the graph:
  - **agents that build**;
  - **agents that review** and send work back to a builder, up to N rounds;
  - **checks**;
  - **Ask me**: a pause where you continue, or write a note that goes back to the builder before it.

  Built-in flows can be duplicated. A flow is checked before it runs: it must start with a builder, and a reviewer must send work back to a builder before it.
- **Pick the flow per task** in the task bar, with a default per workspace (workspace settings → Flow). Each task keeps a copy of its flow, so editing a flow never changes a task that already started.
- The run screen, timeline, filters and desk cards follow the task's flow: each agent has its own node, lane and filter, and each reviewer has its own loop. Questions, verdicts and "interrupted" notes name the agent that sent them.
- API: `GET/POST /api/flows`, `PATCH/DELETE /api/flows/:id`; `flowId` on `POST /api/tasks`; `defaultFlowId` on workspaces. An agent used by a flow can't be deleted.
- **Create your own agents.** "New agent" in **Crew** (and in a workspace's own crew): pick a name, a role (**builds**: edits files and runs commands, or **reviews**: only reads and approves or sends back), the AI that runs it, a personality and extra instructions. Agents you create can be deleted; Forge and Hawk can't, and their roles are fixed. Add them to a flow to put them to work.
- API: `POST /api/agents` and `DELETE /api/agents/:id` for agents you created (on Forge and Hawk, `DELETE` still resets a workspace's copy).

### Changed

- **Flows are data.** "Build & Review" is now a built-in flow (`BUILD_AND_REVIEW` in `@forgeboard/shared`) that the server runs step by step (`runFlow`), instead of a fixed Forge → checks → Hawk loop. Each task keeps a copy of its flow; tasks from before have none and run as Build & Review.
- **Agents have a role.** `builder` (edits files) or `reviewer` (read only). Providers decide permissions by role instead of by agent id: Claude Code tools and the Codex sandbox.
- **Versioned migrations.** The database records its schema version (`PRAGMA user_version`), and each migration runs once, in order. New `flows` table, empty for now.

## [1.9.2] — 2026-11-11

Polish: fewer stale decisions, rules and wasted steps.

### Changed

- "Remember as a house rule" on desk question cards now starts unticked. Most answers only matter for that task, and saved rules apply to every future task in the repository; tick it when the answer is a real convention.

### Fixed

- **"To check" shows only the decisions that still hold.** Each list Forge sends now replaces the previous one instead of adding to it, and Forge resends it after every step. Before, a decision your message had undone (e.g. "didn't add sorting", after you asked for sorting) stayed on the card.
- **Hawk's verdict follows the UI language.** The summary and issues sometimes came back in English with the UI in Portuguese.
- **Forge edits files with its file tools.** It used to try `cat > file` first, get refused and then retry with the right tool, wasting a step on every task.

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
