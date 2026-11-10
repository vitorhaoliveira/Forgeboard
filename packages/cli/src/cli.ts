/**
 * `forgeboard`: starts the local API and the web app on one port and opens the browser.
 *
 * The API answers /api/*; every other request goes to the bundled Next.js server,
 * which runs as a child process on a free loopback port.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === "string" ? __VERSION__ : "dev";
const DEFAULT_PORT = 4317;

const dim = (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[22m` : s);
const bold = (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[22m` : s);
const orange = (s: string) => (process.stdout.isTTY ? `\x1b[38;5;208m${s}\x1b[39m` : s);

const HELP = `
${bold("forgeboard")} ${dim(`v${VERSION}`)}
A local cockpit for AI coding agents.

Usage
  forgeboard [options]

Options
  -p, --port <port>     Port to serve on (default ${DEFAULT_PORT})
      --data-dir <dir>  Where tasks, settings and worktrees live (default ~/.forgeboard)
      --no-open         Don't open the browser
  -v, --version         Print the version
  -h, --help            Show this help
`;

function fail(message: string): never {
  console.error(`\n${orange("✖")} ${message}\n`);
  process.exit(1);
}

/** Claude Code is optional: without it the Mock crew still works. */
function checkClaude(): boolean {
  const bin = process.env.FORGEBOARD_CLAUDE_BIN ?? "claude";
  const result = spawnSync(bin, ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
  return result.status === 0;
}

function freePort(): Promise<number> {
  return new Promise((ok, ko) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", ko);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      srv.close(() => (address && typeof address === "object" ? ok(address.port) : ko(new Error("No free port"))));
    });
  });
}

async function waitFor(url: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("The web app stopped while starting.");
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("The web app took too long to start.");
}

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", '""', url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // no browser available: the URL is printed anyway
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      port: { type: "string", short: "p" },
      "data-dir": { type: "string" },
      "no-open": { type: "boolean", default: false },
      version: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (values.help) return void console.log(HELP);
  if (values.version) return void console.log(VERSION);

  const port = Number(values.port ?? process.env.FORGEBOARD_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`"${values.port}" isn't a valid port.`);
  const dataDir = resolve(values["data-dir"] ?? process.env.FORGEBOARD_DATA_DIR ?? join(homedir(), ".forgeboard"));

  const webDir = join(dirname(fileURLToPath(import.meta.url)), "web");
  if (!existsSync(join(webDir, "server.js"))) fail("The web app is missing from this install. Try reinstalling forgeboard.");

  // The server reads these when it loads.
  process.env.FORGEBOARD_PORT = String(port);
  process.env.FORGEBOARD_DATA_DIR = dataDir;
  process.env.FORGEBOARD_WEB_ORIGINS = `http://localhost:${port},http://127.0.0.1:${port}`;

  const hasClaude = checkClaude();
  const webPort = await freePort();
  const web = spawn(process.execPath, [join(webDir, "server.js")], {
    cwd: webDir,
    env: { ...process.env, NODE_ENV: "production", PORT: String(webPort), HOSTNAME: "127.0.0.1", NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let webErrors = "";
  web.stderr?.on("data", (chunk: Buffer) => (webErrors = (webErrors + chunk.toString()).slice(-4_000)));

  const stop = (code = 0) => {
    if (web.exitCode === null) web.kill();
    process.exit(code);
  };
  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));
  web.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`\n${orange("✖")} The web app stopped (exit ${code}).\n${webErrors}`);
      process.exit(1);
    }
  });

  try {
    await waitFor(`http://127.0.0.1:${webPort}/`, web, 30_000);
  } catch (err) {
    web.kill();
    fail(`${err instanceof Error ? err.message : err}\n${webErrors}`);
  }

  const { startServer } = await import("../../../apps/server/src/start.js");
  const server = startServer({
    webUpstream: `http://127.0.0.1:${webPort}`,
    onListening: (url) => {
      console.log(`\n  ${orange("▲")} ${bold("Forgeboard")} ${dim(`v${VERSION}`)}\n`);
      console.log(`  ${dim("➜")} ${bold(url)}`);
      console.log(`  ${dim("➜")} ${dim(`Data: ${dataDir}`)}`);
      if (!hasClaude) {
        console.log(`\n  ${orange("!")} Claude Code wasn't found. Install it and log in to use real agents,`);
        console.log(`    or set the crew to "Mock (no AI)" to try Forgeboard without it.`);
      }
      console.log(`\n  ${dim("Press Ctrl+C to stop.")}\n`);
      if (!values["no-open"]) openBrowser(url);
    },
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (web.exitCode === null) web.kill();
    if (err.code === "EADDRINUSE") fail(`Port ${port} is already in use. Is Forgeboard already running? Or pick another one: forgeboard --port ${port + 1}`);
    fail(err.message);
  });
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
