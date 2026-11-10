import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { config } from "../config.js";
import type { Provider, RunContext } from "./types.js";

const execFileAsync = promisify(execFile);

/** Long tool outputs (big files, noisy commands) are cut to keep the UI fast. */
const MAX_TOOL_OUTPUT = 20_000;

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | {
      type: "tool_result";
      tool_use_id: string;
      content?: string | { type: string; text?: string }[];
      is_error?: boolean;
    }
  | { type: string };

/** One line of `claude -p --output-format stream-json`. */
type StreamLine =
  | { type: "system"; subtype?: string }
  | { type: "assistant"; message: { content: ContentBlock[] } }
  | { type: "user"; message: { content: ContentBlock[] | string } }
  | {
      type: "result";
      subtype?: string;
      is_error?: boolean;
      result?: string;
      total_cost_usd?: number;
      duration_ms?: number;
    };

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c?.text === "string" ? c.text : ""))
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
      return {
        available: false,
        detail: `"${config.claudeBin}" not found. Install Claude Code and log in.`,
      };
    }
  },

  run(ctx: RunContext) {
    return new Promise<void>((resolve) => {
      const child = spawn(
        config.claudeBin,
        [
          "-p",
          ctx.prompt,
          "--output-format",
          "stream-json",
          "--verbose",
          "--permission-mode",
          ctx.permissionMode,
        ],
        { cwd: ctx.cwd, stdio: ["ignore", "pipe", "pipe"] },
      );

      let gotResult = false;
      let stderr = "";

      const onAbort = () => child.kill("SIGTERM");
      ctx.signal.addEventListener("abort", onAbort, { once: true });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4_000);
      });

      const lines = createInterface({ input: child.stdout });
      lines.on("line", (raw) => {
        if (!raw.trim()) return;
        let line: StreamLine;
        try {
          line = JSON.parse(raw) as StreamLine;
        } catch {
          return; // Not JSON: ignore stray output.
        }

        if (line.type === "assistant") {
          for (const block of line.message.content) {
            if (block.type === "text" && "text" in block && block.text.trim()) {
              ctx.emit({ type: "text", text: block.text });
            } else if (block.type === "tool_use" && "id" in block) {
              ctx.emit({ type: "tool_use", toolUseId: block.id, name: block.name, input: block.input });
            }
          }
        } else if (line.type === "user" && Array.isArray(line.message.content)) {
          for (const block of line.message.content) {
            if (block.type === "tool_result" && "tool_use_id" in block) {
              ctx.emit({
                type: "tool_result",
                toolUseId: block.tool_use_id,
                output: truncate(toolResultText(block.content)),
                isError: Boolean(block.is_error),
              });
            }
          }
        } else if (line.type === "result") {
          gotResult = true;
          const costUsd = line.total_cost_usd ?? null;
          const durationMs = line.duration_ms ?? null;
          if (line.is_error) {
            ctx.emit({ type: "error", message: line.result || `Claude Code failed (${line.subtype})` });
          } else {
            ctx.emit({ type: "result", summary: line.result ?? "", costUsd, durationMs });
          }
        }
      });

      child.on("error", (err) => {
        if (!gotResult && !ctx.signal.aborted) {
          gotResult = true;
          ctx.emit({ type: "error", message: `Could not start Claude Code: ${err.message}` });
        }
      });

      child.on("close", (code) => {
        ctx.signal.removeEventListener("abort", onAbort);
        if (!gotResult && !ctx.signal.aborted) {
          ctx.emit({
            type: "error",
            message: `Claude Code exited with code ${code}${stderr ? `:\n${stderr.trim()}` : ""}`,
          });
        }
        resolve();
      });
    });
  },
};
