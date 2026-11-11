import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SERVER_PORT } from "@forgeboard/shared";

const dataDir = process.env.FORGEBOARD_DATA_DIR ?? join(homedir(), ".forgeboard");

export const config = {
  port: Number(process.env.FORGEBOARD_PORT ?? DEFAULT_SERVER_PORT),
  /** Only listen on loopback: this server can edit files on your machine. */
  host: "127.0.0.1",
  dataDir,
  /** Each task gets its own git worktree here, so your checkout is never touched. */
  worktreesDir: join(dataDir, "worktrees"),
  /** Browser origins allowed to call the API. */
  webOrigins: (process.env.FORGEBOARD_WEB_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((o) => o.trim()),
  claudeBin: process.env.FORGEBOARD_CLAUDE_BIN ?? "claude",
  codexBin: process.env.FORGEBOARD_CODEX_BIN ?? "codex",
  /** Max time for one check command (tests, lint…). */
  checkTimeoutMs: Number(process.env.FORGEBOARD_CHECK_TIMEOUT_MS ?? 5 * 60_000),
};
