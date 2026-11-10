import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SERVER_PORT } from "@forgeboard/shared";

export const config = {
  port: Number(process.env.FORGEBOARD_PORT ?? DEFAULT_SERVER_PORT),
  /** Only listen on loopback: this server can edit files on your machine. */
  host: "127.0.0.1",
  dataDir: process.env.FORGEBOARD_DATA_DIR ?? join(homedir(), ".forgeboard"),
  /** Browser origins allowed to call the API. */
  webOrigins: (process.env.FORGEBOARD_WEB_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((o) => o.trim()),
  claudeBin: process.env.FORGEBOARD_CLAUDE_BIN ?? "claude",
};
