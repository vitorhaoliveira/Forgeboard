import type { AgentId, ForgeCommands, Locale, ProviderId } from "@forgeboard/shared";

/** What a provider reports while an agent works. The orchestrator adds who said it. */
export type AgentActivity =
  | { type: "text"; text: string }
  | { type: "tool_use"; toolUseId: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; output: string; isError: boolean };

export interface StepInput {
  role: AgentId;
  prompt: string;
  /** Directory the agent works in (the task's worktree). */
  cwd: string;
  permissionMode: "plan" | "acceptEdits";
  /** Tools the agent may use without asking, e.g. "Bash(npm:*)". */
  allowedTools?: string[];
  /** Tools the agent can't use at all (Claude Code `--disallowedTools`). */
  disallowedTools?: string[];
  /** The workspace's setting for what Forge may run (providers with their own sandbox use it). */
  commands?: ForgeCommands;
  /** Called as soon as the provider knows the session id, so an interrupted step can be resumed. */
  onSession?: (id: string) => void;
  /** Continue a previous session instead of starting fresh (after a question). */
  resumeSession?: string;
  locale: Locale;
  /** Only used by the mock provider to script a believable run. */
  round: number;
  signal: AbortSignal;
  emit: (activity: AgentActivity) => void;
}

export interface StepOutput {
  sessionId: string | null;
  /** The agent's final message. */
  text: string;
  costUsd: number | null;
  durationMs: number | null;
}

export class AbortedError extends Error {
  constructor() {
    super("Stopped");
  }
}

export interface Provider {
  id: ProviderId;
  label: string;
  check(): Promise<{ available: boolean; detail?: string }>;
  /** Runs one agent step to completion. Throws on failure or AbortedError when stopped. */
  run(input: StepInput): Promise<StepOutput>;
}
