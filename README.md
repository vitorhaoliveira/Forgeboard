# Forgeboard

**Local cockpit for AI coding agents.** Describe a task, watch the agent work in real time, and review what it did, all from your browser while everything runs on your machine.

> Status: **v0, foundation**. One agent, live streaming, run history. Next up (v1): Builder + Reviewer agents talking to each other, git worktrees and a diff review step.

## How it works

```
┌──────────────── your machine ────────────────┐
│  Browser (Next.js UI)  ←── SSE ───┐          │
│                                    │          │
│  Local server (Node + Hono) ───────┘          │
│   ├─ Runner: starts, streams and stops runs   │
│   ├─ Providers: Claude Code CLI · Mock        │
│   └─ SQLite (~/.forgeboard/forgeboard.db)     │
└───────────────────────────────────────────────┘
```

- **No API key needed.** The Claude Code provider drives the `claude` CLI you already have, using its existing login.
- **Every provider is normalized** into the same event stream (`text`, `tool_use`, `tool_result`, `result`, `error`), so the UI doesn't care which agent is running.
- **Resumable streams.** Events are stored, and the SSE endpoint replays from `Last-Event-ID`, so reloading the page mid-run loses nothing.
- **Local only.** The server listens on `127.0.0.1` and only accepts requests from the web UI's origin.

## Getting started

Requirements: Node 22.13+, pnpm, and optionally [Claude Code](https://docs.claude.com/en/docs/claude-code) logged in.

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000, add a repository folder in the sidebar and run a task.

No Claude Code? Pick **Mock** in the agent selector to see a scripted run without spending tokens.

### Permission modes

| Mode | What the agent can do |
|---|---|
| **Read only** | Explore the code and answer or propose a plan. No files change. |
| **Can edit files** | Edit files directly in the repository. Commit your work first. (v1 moves this into an isolated git worktree.) |

### Configuration

| Variable | Default |
|---|---|
| `FORGEBOARD_PORT` | `4317` |
| `FORGEBOARD_DATA_DIR` | `~/.forgeboard` |
| `FORGEBOARD_WEB_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` |
| `FORGEBOARD_CLAUDE_BIN` | `claude` |
| `NEXT_PUBLIC_FORGEBOARD_API` | `http://127.0.0.1:4317` |

## Project structure

```
apps/
  server/   Local API: tasks, SSE streaming, providers, SQLite
  web/      Next.js UI
packages/
  shared/   Types shared by server and web (RunEvent, Task…)
```

## Roadmap

- [x] **v0 — Foundation**: run a task, live stream, cancel, history
- [ ] **v1 — Builder + Reviewer**: agents in a loop, git worktree per task, diff review (approve / request changes / discard)
- [ ] **v1.5 — Public demo**: record runs and replay them in a hosted demo
- [ ] **v2 — Lead & planning**: task breakdown, plan approval, graph view, human intervention
- [ ] **v3 — Parallel & providers**: kanban, parallel runs, Codex CLI, API keys, cost dashboard
- [ ] **v4 — Routines**: reusable task templates, scheduling, custom agent roles
- [ ] **v5 — Polish**: command palette, embedded terminal, accessibility, tests
