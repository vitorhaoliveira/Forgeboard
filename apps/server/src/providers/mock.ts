import type { RunEventPayload } from "@forgeboard/shared";
import type { Provider, RunContext } from "./types.js";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

/**
 * A scripted fake agent. Useful to build the UI without spending tokens,
 * and the starting point for the public demo (replayed runs).
 */
export const mockProvider: Provider = {
  id: "mock",
  label: "Mock (no AI, for testing)",

  async check() {
    return { available: true, detail: "Scripted run, no tokens used" };
  },

  async run(ctx: RunContext) {
    const script: [number, RunEventPayload][] = [
      [600, { type: "text", text: `Got it. I'll start by looking at the project structure to plan: **${ctx.prompt}**` }],
      [500, { type: "tool_use", toolUseId: "t1", name: "Glob", input: { pattern: "src/**/*.tsx" } }],
      [700, { type: "tool_result", toolUseId: "t1", output: "src/app/page.tsx\nsrc/components/UsersTable.tsx\nsrc/lib/api.ts", isError: false }],
      [500, { type: "tool_use", toolUseId: "t2", name: "Read", input: { file_path: `${ctx.cwd}/src/components/UsersTable.tsx` } }],
      [800, { type: "tool_result", toolUseId: "t2", output: "export function UsersTable({ users }) {\n  return (\n    <table>…</table>\n  );\n}", isError: false }],
      [900, { type: "text", text: "The table renders every user at once. I'll add `page` and `pageSize` props and a small pagination control." }],
      [500, { type: "tool_use", toolUseId: "t3", name: "Edit", input: { file_path: `${ctx.cwd}/src/components/UsersTable.tsx`, old_string: "users }", new_string: "users, page, pageSize }" } }],
      [600, { type: "tool_result", toolUseId: "t3", output: "The file has been updated.", isError: false }],
      [500, { type: "tool_use", toolUseId: "t4", name: "Bash", input: { command: "npm test -- UsersTable", description: "Run the table tests" } }],
      [1200, { type: "tool_result", toolUseId: "t4", output: "PASS src/components/UsersTable.test.tsx\n  ✓ renders the first page (12 ms)\n  ✓ moves to the next page (8 ms)\n\nTests: 2 passed, 2 total", isError: false }],
      [600, { type: "text", text: "Pagination is in place and the tests pass." }],
    ];

    const started = Date.now();
    try {
      for (const [delay, payload] of script) {
        await sleep(delay, ctx.signal);
        ctx.emit(payload);
      }
    } catch {
      return; // Aborted: the runner records the cancellation.
    }
    ctx.emit({
      type: "result",
      summary: "Added pagination to `UsersTable` (page + pageSize props) and verified it with the existing tests.",
      costUsd: 0,
      durationMs: Date.now() - started,
    });
  },
};
