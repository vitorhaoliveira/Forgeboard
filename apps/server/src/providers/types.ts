import type { PermissionMode, ProviderId, RunEventPayload } from "@forgeboard/shared";

export interface RunContext {
  prompt: string;
  /** Directory the agent works in. */
  cwd: string;
  permissionMode: PermissionMode;
  signal: AbortSignal;
  emit: (payload: RunEventPayload) => void;
}

export interface Provider {
  id: ProviderId;
  label: string;
  check(): Promise<{ available: boolean; detail?: string }>;
  /**
   * Runs the agent until it finishes. Must emit exactly one "result" or "error"
   * event before resolving, unless the run was aborted.
   */
  run(ctx: RunContext): Promise<void>;
}
