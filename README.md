# Forgeboard

**Your crew of AI coding agents, on your machine.** Describe a task; Forge builds it, the checks run, Hawk reviews it and sends it back until it's right. Agents ask you when they need a decision. You merge when you're happy. Need a different process? Build your own flow, with your own agents.

![Forgeboard demo: answer the agent's question, watch the crew build, check and review, then merge](docs/demo.gif)

<sub>The demo above runs in the browser with a simulated crew (`pnpm demo`). See [Live demo](#live-demo).</sub>

> Status: **v2.1**. Your own flows (builders, reviewers, checks, "Ask me" pauses) and your own agents, a flow per task, a conversation with the crew (message it mid-run, "decide and tell me" mode), Claude Code and Codex as providers, install with `npx forgeboard`, agents ask with forms and editable plans (A2UI), public demo mode, workspaces per project, live run view, merge decision, house rules, English (US) and Brazilian Portuguese. Next up (v2.2): a drag-and-drop canvas for flows.

## How it works

Every task runs a **flow**. The built-in one, **Build & Review**:

```
your task → Forge (builds) → Checks (tests · lint · types) → Hawk (reviews)
                 ↑                                              │
                 └──────── changes requested (up to N rounds) ──┘
                                                                ↓
                                              You: merge · send back · discard
```

- **Make your own flows** in **Flows**, as a list of steps with a live preview. There are four kinds of step:
  - **agents that build** (edit files);
  - **agents that review** (read only, and send work back to a builder up to N rounds);
  - **checks**;
  - **Ask me** pauses: you continue, or write a note that goes back to the builder before it.

  For example: *Forge → Checks → Hawk ↩ Forge → Scribe (docs) → Ask me*. Pick the flow in the task bar; each workspace has a default.
- **Make your own agents** in **Crew**. Each gets a name, a role (builds or reviews), the AI that runs it (Claude Code or Codex), a personality and instructions. What an agent may do follows from its role.

- **Every task runs in its own git worktree** (`~/.forgeboard/worktrees/<task>`), on a branch like `fb/add-pagination-ab12c`. Your checkout is never touched until you merge.
- **Checks are objective.** Forgeboard runs your repo's own commands (detected from `package.json`, editable in Settings) wherever the flow has a checks step. A reviewer can't approve while a check fails.
- **You talk to the crew.** Each run is a conversation: reply to questions by typing, or message the builder while it works and it picks your message up right away (same session). Prefer fewer interruptions? In **Decide and tell me** mode, builders go with their best guess and list what they decided for you to check.
- **Rich questions.** When several decisions are needed, Forge asks with a small form; for bigger tasks it proposes a plan you can edit before anything is built. Forms use [A2UI](https://a2ui.org/) with a fixed catalog of Forgeboard components, validated on the server and in the browser.
- **The crew learns.** Answers can be saved as **house rules**, and Hawk suggests rules from what it sees in reviews. Every agent follows them on every task.
- **One workspace per project.** Group a project's repositories in a workspace with its own crew and house rules (general → workspace → repository). The "All" desk shows what needs you across every workspace.
- **You stay in charge.** The merge screen leads with what changed, how we know it works and the risk; then the diff, where you can leave files out.

![Desk](docs/screenshots/desk.png)

| Question with a form | Editable plan |
| --- | --- |
| ![Forge asks four decisions in one form](docs/screenshots/questions.png) | ![Forge proposes a plan: steps can be unchecked, reordered and rewritten](docs/screenshots/plan.png) |

![All workspaces](docs/screenshots/workspaces.png)

![Run](docs/screenshots/run.png)

![Decision](docs/screenshots/decide.png)

## Live demo

The web app has a **demo mode**: a simulated crew runs entirely in the browser, with three workspaces and tasks in every state. Visitors can answer the agent's question, watch the run, review the diff, merge, replay finished runs and start new tasks. No server, no AI and no real repository involved.

Run it locally:

```bash
pnpm demo
```

Publish it on Vercel:

1. Import the repository at [vercel.com/new](https://vercel.com/new).
2. Set **Root Directory** to `apps/web` (Vercel installs the pnpm workspace from the root).
3. Add the environment variable `NEXT_PUBLIC_FORGEBOARD_DEMO=1`.
4. Deploy.

## Getting started

Requirements: **Node 22.13+**, **git**, and at least one agent CLI logged in: [Claude Code](https://docs.claude.com/en/docs/claude-code) (Claude subscription or API key) and/or the [Codex CLI](https://github.com/openai/codex) (ChatGPT account or OpenAI API key). Forgeboard never sees your keys. Pick the provider of each agent in **Crew**, e.g. Claude builds and Codex reviews.

```bash
npx forgeboard
```

That's it: it opens http://localhost:4317. Create a workspace, pick one or more repositories with "Choose folder…" (any git repo with at least one commit), and type a task in the top bar. To keep it installed: `npm i -g forgeboard`, then run `forgeboard`.

| Option | Default | |
|---|---|---|
| `-p, --port <port>` | `4317` | Port to serve on (loopback only) |
| `--data-dir <dir>` | `~/.forgeboard` | Tasks, settings and worktrees |
| `--no-open` | | Don't open the browser |

### From source

To work on Forgeboard itself (needs pnpm):

```bash
git clone https://github.com/vitorhaoliveira/Forgeboard.git
cd Forgeboard
pnpm install
pnpm dev
```

The API runs on :4317 and the web app on http://localhost:3000, with hot reload.

**Try it without spending tokens:** in **Crew** (the default crew), set both agents to **Mock (no AI)**. The scripted crew asks a question, gets a review rejected, fixes it and gets approved — with real file changes, so merging works too.

### What agents may do

What an agent may do follows from its role, not its name:

| Role | Files | Commands |
|---|---|---|
| **Builds** (e.g. Forge) | edits files in the task's worktree | package managers (`npm`, `pnpm`, `yarn`, `bun`, `npx`, `node`) and read-only git/`ls`; anything else is refused |
| **Reviews** (e.g. Hawk) | read only | none (Claude Code runs it without shell or edit tools); it gets the check results from Forgeboard |

Agents never commit, push or touch your branch. Merging is always your click.

With **Codex**, its own sandbox does the isolation: reviewers run read-only, and builders can only write inside the task's worktree (with network in Standard, without it in Restricted).

**Standard** (the default) lets Forge run package managers and `node`, which in practice can run any code on your machine. For repositories you don't fully trust, switch the workspace to **Restricted** (workspace settings → Safety): Forge then only edits files and Forgeboard runs the checks. The API is local-only and, with `forgeboard`, needs an access key printed as a link in the terminal. See [SECURITY.md](SECURITY.md) for what is and isn't protected.

### Languages

The UI follows your browser language on first visit (English or Português) and can be switched with the **EN / PT** button in the sidebar. Agents write their messages in the same language as the UI.

### Configuration

| Variable | Default |
|---|---|
| `FORGEBOARD_PORT` | `4317` |
| `FORGEBOARD_DATA_DIR` | `~/.forgeboard` |
| `FORGEBOARD_WEB_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` |
| `FORGEBOARD_CLAUDE_BIN` | `claude` |
| `FORGEBOARD_CODEX_BIN` | `codex` |
| `FORGEBOARD_CHECK_TIMEOUT_MS` | `300000` |
| `NEXT_PUBLIC_FORGEBOARD_API` | `http://127.0.0.1:4317` |

## Project structure

```
apps/
  server/   Local API (Hono + SQLite): orchestrator, git worktrees, checks, providers, SSE
  web/      Next.js UI (next-intl, Tailwind): All desk, workspace desk and settings, Run, Decide, Crew, Settings
packages/
  cli/      The `forgeboard` npm package: one command that serves the API and the web app on one port
  shared/   Types shared by server and web (Task, RunEvent, Verdict…) and the A2UI form catalog
```

### Releasing

1. Bump `version` in `packages/cli/package.json` and add the section to `CHANGELOG.md`.
2. Merge to `main`, then tag: `git tag v2.1.1 && git push origin v2.1.1`.
3. The **Publish to npm** workflow checks the tag matches the version, builds the package and publishes it with npm Trusted Publishing (no token; set up once on npmjs.com under the package's Settings → Trusted Publisher). It then creates the GitHub release, with the version's `CHANGELOG.md` section as notes; the title comes from the section's first line ("Talk to the crew: …" → "v1.9.0 — Talk to the crew").

The very first version was published by hand (`pnpm package`, then `npm publish --access public` in `packages/cli`), since npm only lets you add a trusted publisher to a package that already exists.

To try the package locally: `pnpm package`, then `npm pack` in `packages/cli` and install the `.tgz` anywhere.

Key server files: `orchestrator.ts` (`runFlow`, which runs a task's flow step by step), `prompts.ts` (what each agent is told and how its answer is parsed), `git.ts` (worktrees, diff, merge), `checks.ts`. Flows and their validation (`BUILD_AND_REVIEW`, `validateFlow`) live in `packages/shared`.

## Roadmap

- [x] **v0 — Foundation**: run a task, live stream, cancel, history
- [x] **v1 — Crew & review**: Build & Review loop, worktrees, checks, agent questions, merge decision, house rules, EN/PT
- [x] **v1.1 — Workspaces**: projects with their own repos, crew and rules; "All" desk
- [x] **v1.5 — Public demo**: simulated crew in the browser, replay of finished runs
- [x] **v1.6 — Rich questions (A2UI)**: agents ask with small forms and editable plans
- [x] **v1.7 — One-command install**: `npx forgeboard`, published to npm from a version tag
- [x] **v1.8 — Codex**: OpenAI's Codex CLI as a provider for any agent, sandboxed
- [x] **v1.9 — Conversation**: talk to the crew mid-run, reply by typing, "decide and tell me" mode
- [x] **v2.0 — Flow studio**: your own flows (builders, reviewers with loops, checks, "Ask me" pauses), your own agents with a role, a flow per task
- [x] **v2.1 — Folder picker**: choose a repository from your folders instead of typing its path
- [ ] **v2.2 — Flow canvas**: drag-and-drop editor for flows
- [ ] **v2.3 — Parallel steps**: run agents side by side in a flow
- [ ] **v3 — More agents**: API-key providers, parallel runs, cost dashboard
- [ ] **v4 — Routines**: scheduled and reusable tasks

## License

[MIT](LICENSE)
