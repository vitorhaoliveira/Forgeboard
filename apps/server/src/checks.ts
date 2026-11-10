import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckCommand, CheckResult } from "@forgeboard/shared";
import { config } from "./config.js";

const MAX_OUTPUT = 4_000;

function packageManager(repoPath: string): string {
  if (existsSync(join(repoPath, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(repoPath, "yarn.lock"))) return "yarn";
  if (existsSync(join(repoPath, "bun.lockb")) || existsSync(join(repoPath, "bun.lock"))) return "bun";
  return "npm";
}

/** Guesses the repo's checks from package.json scripts. The user can edit them later. */
export function detectChecks(repoPath: string): CheckCommand[] {
  const pkgPath = join(repoPath, "package.json");
  if (!existsSync(pkgPath)) return [];
  let scripts: Record<string, string> = {};
  try {
    scripts = (JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
  } catch {
    return [];
  }
  const pm = packageManager(repoPath);
  const run = (script: string) => (pm === "npm" ? `npm run ${script}` : `${pm} ${script}`);
  const checks: CheckCommand[] = [];

  const typecheck = ["typecheck", "type-check", "tsc", "check-types"].find((s) => scripts[s]);
  if (typecheck) checks.push({ name: "types", command: run(typecheck) });
  if (scripts.lint) checks.push({ name: "lint", command: run("lint") });
  if (scripts.test && !scripts.test.includes("no test specified")) {
    checks.push({ name: "tests", command: pm === "npm" ? "npm test" : `${pm} test` });
  }
  return checks;
}

function runOne(cwd: string, check: CheckCommand, signal: AbortSignal): Promise<CheckResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let output = "";
    // CI=1 makes watch-mode tools (vitest, jest) run once and exit.
    const child = spawn("sh", ["-c", check.command], {
      cwd,
      env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-MAX_OUTPUT * 2);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);

    const kill = () => {
      try {
        process.kill(-child.pid!, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    };
    const timer = setTimeout(() => {
      output += `\n[Forgeboard] Stopped after ${Math.round(config.checkTimeoutMs / 1000)}s.`;
      kill();
    }, config.checkTimeoutMs);
    signal.addEventListener("abort", kill, { once: true });

    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", kill);
      resolve({
        ...check,
        ok: code === 0,
        durationMs: Date.now() - started,
        output: output.trim().slice(-MAX_OUTPUT),
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ...check, ok: false, durationMs: Date.now() - started, output: err.message });
    });
  });
}

export async function runChecks(cwd: string, checks: CheckCommand[], signal: AbortSignal): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    if (signal.aborted) break;
    results.push(await runOne(cwd, check, signal));
  }
  return results;
}
