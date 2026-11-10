# Security

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's private report instead: the repository's **Security** tab → **Report a vulnerability**. You'll get an answer within a few days, and a fix is released as a patch version with credit if you want it.

Supported: the latest release on npm (`npx forgeboard`).

## What Forgeboard protects

- **Only your machine.** The server listens on `127.0.0.1` only.
- **Only Forgeboard's own UI.** The API accepts only a local `Host` (no DNS rebinding), refuses changes from other origins, and requires a JSON body for every change, so other websites can't drive it.
- **Access key.** With `forgeboard`, every API call needs a key kept in `~/.forgeboard/access-key` (readable only by you). The terminal prints a link that signs the browser in with an HttpOnly cookie. Other people and programs on the machine can't use the API without it. (`pnpm dev`, for working on Forgeboard itself, runs without the key.)
- **Your branch.** Each task runs in its own git worktree and branch. Agents never commit, push or touch your checkout; merging is always your click.
- **No secrets.** Claude Code handles its own login; Forgeboard never sees your key or subscription.

## What it doesn't protect

- **Forge can run code.** In the **Standard** mode (the default), Forge may run `npm`, `pnpm`, `yarn`, `bun`, `npx` and `node` to install and test. That can run any code with your user's permissions, also outside the task's worktree. A malicious instruction hidden in a repository (prompt injection) could abuse it. Use **Restricted** mode (workspace settings → Safety) for repositories you don't fully trust: Forge then only edits files, and Forgeboard runs the checks.
- **Checks run the repository's own commands** (`npm test`…), like running them yourself.
- **Merging is trust.** Review changes to `package.json` scripts, lockfiles and CI files before merging.
- **Programs already running as your user** can read the access key, like any of your files.
- **Local data isn't encrypted**: prompts, agent output and diffs live in `~/.forgeboard`.
