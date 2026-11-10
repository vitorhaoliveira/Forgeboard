# Changelog

All notable changes to Forgeboard are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
