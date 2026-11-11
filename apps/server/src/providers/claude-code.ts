import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { config } from "../config.js";
import { AbortedError, type Provider, type StepInput, type StepOutput } from "./types.js";

const execFileAsync = promisify(execFile);

/** Long tool outputs (big files, noisy commands) are cut to keep the UI fast. */
const MAX_TOOL_OUTPUT = 20_000;

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content?: unknown; is_error?: boolean }
  | { type: string };

/** One line of `claude -p --output-format stream-json`. */
type StreamLine =
  | { type: "system"; subtype?: string; session_id?: string }
  | { type: "assistant"; message: { content: ContentBlock[] } }
  | { type: "user"; message: { content: ContentBlock[] | string } }
  | {
      type: "result";
      subtype?: string;
      is_error?: boolean;
      result?: string;
      session_id?: string;
      total_cost_usd?: number;
      duration_ms?: number;
    };

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: { text?: unknown }) => (typeof c?.text === "string" ? c.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function truncate(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT) return text;
  return `${text.slice(0, MAX_TOOL_OUTPUT)}\n… (${text.length - MAX_TOOL_OUTPUT} more characters)`;
}

/**
 * Drives the Claude Code CLI in headless mode. It uses whatever login the CLI
 * already has (subscription or API key), so Forgeboard never sees a key.
 */
export const claudeCodeProvider: Provider = {
  id: "claude-code",
  label: "Claude Code",

  async check() {
    try {
      const { stdout } = await execFileAsync(config.claudeBin, ["--version"], { timeout: 10_000 });
      return { available: true, detail: stdout.trim() };
    } catch {
      return { available: false, detail: `"${config.claudeBin}" not found. Install Claude Code and log in.` };
    }
  },

  run(input: StepInput) {
    return new Promise<StepOutput>((resolve, reject) => {
      const args = [
        "-p",
        input.prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        input.permissionMode,
      ];
      if (input.resumeSession) args.push("--resume", input.resumeSession);
      if (input.allowedTools?.length) args.push("--allowedTools", ...input.allowedTools);
      if (input.disallowedTools?.length) args.push("--disallowedTools", ...input.disallowedTools);

      const child = spawn(config.claudeBin, args, { cwd: input.cwd, stdio: ["ignore", "pipe", "pipe"] });

      let sessionId: string | null = input.resumeSession ?? null;
      let result: StepOutput | null = null;
      let failure: string | null = null;
      let stderr = "";

      const onAbort = () => child.kill("SIGTERM");
      input.signal.addEventListener("abort", onAbort, { once: true });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4_000);
      });

      createInterface({ input: child.stdout }).on("line", (raw) => {
        if (!raw.trim()) return;
        let line: StreamLine;
        try {
          line = JSON.parse(raw) as StreamLine;
        } catch {
          return;
        }
        if (line.type === "system" && line.session_id) {
          sessionId = line.session_id;
          input.onSession?.(line.session_id);
        } else if (line.type === "assistant") {
          for (const block of line.message.content) {
            if (block.type === "text" && "text" in block && block.text.trim()) {
              input.emit({ type: "text", text: block.text });
            } else if (block.type === "tool_use" && "id" in block) {
              input.emit({ type: "tool_use", toolUseId: block.id, name: block.name, input: block.input });
            }
          }
        } else if (line.type === "user" && Array.isArray(line.message.content)) {
          for (const block of line.message.content) {
            if (block.type === "tool_result" && "tool_use_id" in block) {
              input.emit({
                type: "tool_result",
                toolUseId: block.tool_use_id,
                output: truncate(toolResultText(block.content)),
                isError: Boolean(block.is_error),
              });
            }
          }
        } else if (line.type === "result") {
          if (line.is_error) {
            failure = line.result || `Claude Code failed (${line.subtype})`;
          } else {
            result = {
              sessionId: line.session_id ?? sessionId,
              text: line.result ?? "",
              costUsd: line.total_cost_usd ?? null,
              durationMs: line.duration_ms ?? null,
            };
          }
        }
      });

      child.on("error", (err) => {
        failure = `Could not start Claude Code: ${err.message}`;
      });

      child.on("close", (code) => {
        input.signal.removeEventListener("abort", onAbort);
        if (input.signal.aborted) return reject(new AbortedError());
        if (result) return resolve(result);
        reject(new Error(failure ?? `Claude Code exited with code ${code}${stderr ? `:\n${stderr.trim()}` : ""}`));
      });
    });
  },
};
