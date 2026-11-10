# Forgeboard

A local cockpit for AI coding agents. Tell your crew what to do; **Forge** builds in an isolated git worktree, your repo's own checks run, **Hawk** reviews, and nothing reaches your branch until you merge.

![Forgeboard demo](https://raw.githubusercontent.com/vitorhaoliveira/Forgeboard/main/docs/demo.gif)

## Run it

You need **Node 22.13+**, **git**, and [Claude Code](https://docs.claude.com/en/docs/claude-code) logged in (subscription or API key; Forgeboard never sees it).

```bash
npx forgeboard
```

Or install it once:

```bash
npm i -g forgeboard
forgeboard
```

It opens http://localhost:4317. Create a workspace with one or more of your repositories and type a task in the top bar.

**Try it without spending tokens:** in **Crew**, set both agents to **Mock (no AI)**.

### Options

| Option | Default | |
| --- | --- | --- |
| `-p, --port <port>` | `4317` | Port to serve on (loopback only) |
| `--data-dir <dir>` | `~/.forgeboard` | Tasks, settings and worktrees |
| `--no-open` | | Don't open the browser |

## What it does

- Every task runs in its own git worktree, on its own branch. Your checkout is never touched until you merge.
- Your repo's checks (tests, lint, types) run after every build; the reviewer can't approve while one fails.
- Agents ask instead of guessing: questions, small forms and editable plans show up on your desk.
- Answers can become house rules the whole crew follows.
- English (US) and Brazilian Portuguese.

Source, docs and live demo: https://github.com/vitorhaoliveira/Forgeboard
