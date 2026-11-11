import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { config } from "../config.js";
import { AbortedError, type Provider, type StepInput, type StepOutput } from "./types.js";

const execFileAsync = promisify(execFile);
const MAX_TOOL_OUTPUT = 20_000;

/** Items inside `codex exec --json` events (only the fields Forgeboard uses). */
type CodexItem =
  | { id: string; type: "agent_message"; text: string }
  | { id: string; type: "command_execution"; command: string; aggregated_output?: string; exit_code?: number | null; status?: string }
  | { id: string; type: "file_change"; changes?: { path: string; kind?: string }[]; status?: string }
  | { id: string; type: "mcp_tool_call"; server?: string; tool?: string; status?: string }
  | { id: string; type: "web_search"; query?: string }
  | { id: string; type: string };

/** One line of `codex exec --json`. */
type CodexEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.started" }
  | { type: "turn.completed"; usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number } }
  | { type: "turn.failed"; error?: { message?: string } }
  | { type: "item.started" | "item.updated" | "item.completed"; item: CodexItem }
  | { type: "error"; message?: string };

function truncate(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT) return text;
  return `${text.slice(0, MAX_TOOL_OUTPUT)}\n… (${text.length - MAX_TOOL_OUTPUT} more characters)`;
}

/** TOML values for `-c key=value`. */
const toml = (value: string | boolean) => (typeof value === "boolean" ? String(value) : JSON.stringify(value));

/**
 * Codex's own sandbox does the isolation:
 * - Reviewers (Hawk) and leads work read-only.
 * - Builders (Forge) may write only inside the task's worktree. "standard" adds network (to install packages);
 *   "restricted" keeps it off.
 */
export function codexArgs(input: StepInput): string[] {
  const settings: [string, string | boolean][] = [
    ["approval_policy", "never"],
    ["sandbox_mode", input.role === "builder" ? "workspace-write" : "read-only"],
  ];
  if (input.role === "builder") settings.push(["sandbox_workspace_write.network_access", input.commands !== "restricted"]);
  const flags = ["--json", ...settings.flatMap(([k, v]) => ["-c", `${k}=${toml(v)}`])];
  return input.resumeSession ? ["exec", "resume", ...flags, input.resumeSession, input.prompt] : ["exec", ...flags, input.prompt];
}

/**
 * Drives the OpenAI Codex CLI (`codex exec --json`). It uses the CLI's own login
 * (ChatGPT account or API key), so Forgeboard never sees a key.
 */
export const codexProvider: Provider = {
  id: "codex",
  label: "Codex",

  async check() {
    let version: string;
    try {
      version = (await execFileAsync(config.codexBin, ["--version"], { timeout: 10_000 })).stdout.trim();
    } catch {
      return { available: false, detail: `"${config.codexBin}" not found. Install the Codex CLI and log in.` };
    }
    try {
      await execFileAsync(config.codexBin, ["login", "status"], { timeout: 10_000 });
      return { available: true, detail: version };
    } catch {
      return { available: false, detail: `${version}: not logged in. Run "codex login".` };
    }
  },

  run(input: StepInput) {
    return new Promise<StepOutput>((resolve, reject) => {
      const started = Date.now();
      const child = spawn(config.codexBin, codexArgs(input), { cwd: input.cwd, stdio: ["ignore", "pipe", "pipe"] });

      let sessionId: string | null = input.resumeSession ?? null;
      let lastMessage = "";
      let completed = false;
      let failure: string | null = null;
      let lastError: string | null = null;
      let stderr = "";
      const announced = new Set<string>();

      const onAbort = () => child.kill("SIGTERM");
      input.signal.addEventListener("abort", onAbort, { once: true });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4_000);
      });

      const announce = (id: string, name: string, toolInput: Record<string, unknown>) => {
        if (announced.has(id)) return;
        announced.add(id);
        input.emit({ type: "tool_use", toolUseId: id, name, input: toolInput });
      };

      createInterface({ input: child.stdout }).on("line", (raw) => {
        if (!raw.trim()) return;
        let event: CodexEvent;
        try {
          event = JSON.parse(raw) as CodexEvent;
        } catch {
          return;
        }
        if (event.type === "thread.started") {
          sessionId = event.thread_id;
          input.onSession?.(event.thread_id);
        } else if (event.type === "turn.completed") {
          completed = true;
        } else if (event.type === "turn.failed") {
          failure = event.error?.message ?? "Codex failed";
        } else if (event.type === "error") {
          // Retries ("Reconnecting… 2/5") arrive as errors too; keep the last one in case the run fails.
          lastError = event.message ?? lastError;
        } else if (event.type === "item.started" || event.type === "item.completed") {
          const item = event.item;
          const done = event.type === "item.completed";
          if (item.type === "command_execution" && "command" in item) {
            announce(item.id, "Bash", { command: item.command });
            if (done) {
              input.emit({
                type: "tool_result",
                toolUseId: item.id,
                output: truncate(item.aggregated_output ?? ""),
                isError: typeof item.exit_code === "number" && item.exit_code !== 0,
              });
            }
          } else if (item.type === "file_change" && done && "changes" in item) {
            (item.changes ?? []).forEach((change, i) => {
              const id = `${item.id}-${i}`;
              announce(id, change.kind === "add" ? "Write" : "Edit", { file_path: change.path });
              input.emit({ type: "tool_result", toolUseId: id, output: change.kind === "delete" ? "Deleted." : "Updated.", isError: item.status === "failed" });
            });
          } else if (item.type === "mcp_tool_call" && "tool" in item) {
            announce(item.id, `${item.server ?? "mcp"}:${item.tool ?? "tool"}`, {});
            if (done) input.emit({ type: "tool_result", toolUseId: item.id, output: "", isError: item.status === "failed" });
          } else if (item.type === "web_search" && "query" in item) {
            announce(item.id, "WebSearch", { query: item.query });
            if (done) input.emit({ type: "tool_result", toolUseId: item.id, output: "", isError: false });
          } else if (item.type === "agent_message" && done && "text" in item && item.text.trim()) {
            lastMessage = item.text;
            input.emit({ type: "text", text: item.text });
          }
        }
      });

      child.on("error", (err) => {
        failure = `Could not start Codex: ${err.message}`;
      });

      child.on("close", (code) => {
        input.signal.removeEventListener("abort", onAbort);
        if (input.signal.aborted) return reject(new AbortedError());
        if (completed && !failure) {
          // Codex reports tokens, not dollars, so there's no cost to add.
          return resolve({ sessionId, text: lastMessage, costUsd: null, durationMs: Date.now() - started });
        }
        const reason = failure ?? lastError ?? (stderr.trim() || `Codex exited with code ${code}`);
        const hint = /log ?in|auth|401|unauthorized/i.test(reason) ? ' Run "codex login" in a terminal.' : "";
        reject(new Error(hint ? `${reason.trim().replace(/[.\s]*$/, ".")}${hint}` : reason));
      });
    });
  },
};
