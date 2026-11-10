/**
 * Types shared by the local server and the web UI.
 * Every provider (Claude Code, Codex, mock...) is normalized into RunEvent,
 * so the UI never needs to know which agent produced an event.
 */

export type ProviderId = "claude-code" | "mock";

/** How much the agent may change on disk. */
export type PermissionMode = "plan" | "acceptEdits";

export type TaskStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface Repo {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface Task {
  id: string;
  repoId: string;
  prompt: string;
  title: string;
  provider: ProviderId;
  permissionMode: PermissionMode;
  status: TaskStatus;
  costUsd: number | null;
  durationMs: number | null;
  createdAt: string;
  finishedAt: string | null;
}

export type RunEventPayload =
  | { type: "status"; status: TaskStatus }
  | { type: "text"; text: string }
  | { type: "tool_use"; toolUseId: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; output: string; isError: boolean }
  | { type: "result"; summary: string; costUsd: number | null; durationMs: number | null }
  | { type: "error"; message: string };

export type RunEvent = RunEventPayload & {
  taskId: string;
  /** Position of the event inside the task, starting at 1. */
  seq: number;
  ts: string;
};

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  available: boolean;
  detail?: string;
}

export interface CreateTaskInput {
  repoId: string;
  prompt: string;
  provider: ProviderId;
  permissionMode: PermissionMode;
}

export const DEFAULT_SERVER_PORT = 4317;

export function isTerminalStatus(status: TaskStatus): boolean {
  return status === "done" || status === "error" || status === "cancelled";
}
