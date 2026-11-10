/**
 * Types shared by the local server and the web UI.
 *
 * v1 runs one built-in flow, "Build & Review":
 *   your task → Forge (builds) → Checks (tests/lint/types) → Hawk (reviews)
 *   → back to Forge until Hawk approves or rounds run out → you decide (merge / discard).
 * Agents can pause the run to ask you a question.
 */

export type ProviderId = "claude-code" | "mock";

export type Locale = "en-US" | "pt-BR";
export const LOCALES: Locale[] = ["en-US", "pt-BR"];
export const DEFAULT_LOCALE: Locale = "en-US";

export type AgentId = "forge" | "hawk";
export type Actor = AgentId | "checks" | "you" | "system";

export type Personality = "mentor" | "balanced" | "strict";

export type TaskStatus =
  | "queued"
  | "running"
  /** An agent asked you something. */
  | "waiting"
  /** Work is done; you decide whether to merge. */
  | "review"
  | "merged"
  | "discarded"
  | "cancelled"
  | "error";

/** Steps of the Build & Review flow, used to light up the graph. */
export type FlowNode = "task" | "forge" | "checks" | "hawk" | "you" | "merge";
export type NodeState = "idle" | "active" | "done" | "failed" | "warn";

export interface Agent {
  id: AgentId;
  name: string;
  provider: ProviderId;
  personality: Personality;
  /** Extra instructions added to the agent's prompt. */
  instructions: string;
  /** In a workspace with its own crew: true when this agent differs from the default. */
  customized?: boolean;
}

export interface CheckCommand {
  name: string;
  command: string;
}

export interface CheckResult extends CheckCommand {
  ok: boolean;
  durationMs: number;
  /** Last lines of output. */
  output: string;
}

export type WorkspaceColor = "info" | "success" | "violet" | "pink" | "warning";
export const WORKSPACE_COLORS: WorkspaceColor[] = ["info", "success", "violet", "pink", "warning"];

/** A project: one or more repositories that share a crew and house rules. */
export interface Workspace {
  id: string;
  name: string;
  description: string;
  color: WorkspaceColor;
  /** "default" uses the default crew; "custom" keeps its own agent settings. */
  crewMode: "default" | "custom";
  archived: boolean;
  createdAt: string;
}

export interface CreateWorkspaceInput {
  name: string;
  description?: string;
  color: WorkspaceColor;
  /** Copy the crew from another workspace instead of using the default crew. */
  crewFrom?: string | null;
  repoPaths?: string[];
}

export interface Repo {
  id: string;
  workspaceId: string;
  name: string;
  path: string;
  checks: CheckCommand[];
  createdAt: string;
}

export type RuleSource = "you" | "answer" | "hawk";

/** Where a rule applies: everywhere, in one workspace, or in one repository. */
export type RuleScope = "global" | "workspace" | "repo";

export interface HouseRule {
  id: string;
  scope: RuleScope;
  workspaceId: string | null;
  repoId: string | null;
  text: string;
  enabled: boolean;
  source: RuleSource;
  createdAt: string;
}

export type IssueSeverity = "high" | "medium" | "low";

export interface ReviewIssue {
  severity: IssueSeverity;
  message: string;
  file?: string;
  line?: number;
}

export interface Verdict {
  approved: boolean;
  summary: string;
  issues: ReviewIssue[];
  risk: "low" | "medium" | "high";
  /** A rule Hawk thinks the crew should follow from now on. */
  suggestedRule?: string;
}

export interface AgentQuestion {
  question: string;
  context?: string;
  options: string[];
  /** Index into options. */
  suggested?: number;
}

export interface Task {
  id: string;
  workspaceId: string;
  repoId: string;
  prompt: string;
  title: string;
  locale: Locale;
  status: TaskStatus;
  round: number;
  maxRounds: number;
  branch: string | null;
  baseBranch: string | null;
  question: AgentQuestion | null;
  verdict: Verdict | null;
  checks: CheckResult[] | null;
  /** What Forge said it did in its last round. */
  summary: string | null;
  costUsd: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

type WithActor<T> = T & { actor: Actor };

export type RunEventPayload =
  | WithActor<{ type: "status"; status: TaskStatus }>
  | WithActor<{ type: "node"; node: FlowNode; state: NodeState; note?: string }>
  | WithActor<{ type: "round"; round: number }>
  | WithActor<{ type: "text"; text: string }>
  | WithActor<{ type: "tool_use"; toolUseId: string; name: string; input: Record<string, unknown> }>
  | WithActor<{ type: "tool_result"; toolUseId: string; output: string; isError: boolean }>
  | WithActor<{ type: "checks"; results: CheckResult[] }>
  | WithActor<{ type: "verdict"; verdict: Verdict; round: number }>
  | WithActor<{ type: "question"; question: AgentQuestion }>
  | WithActor<{ type: "answer"; text: string; remember: boolean }>
  | WithActor<{ type: "handoff"; to: Actor; label: string }>
  | WithActor<{ type: "step_done"; summary: string; costUsd: number | null; durationMs: number | null }>
  | WithActor<{ type: "merged"; branch: string }>
  | WithActor<{ type: "error"; message: string }>;

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
  locale: Locale;
  maxRounds?: number;
}

export interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  patch: string;
}

export const DEFAULT_SERVER_PORT = 4317;

/** Tasks that will not change anymore. */
export function isFinished(status: TaskStatus): boolean {
  return status === "merged" || status === "discarded" || status === "cancelled" || status === "error";
}

/** Tasks where the server is actively doing something. */
export function isActive(status: TaskStatus): boolean {
  return status === "queued" || status === "running";
}

/** Tasks waiting on you. */
export function needsYou(status: TaskStatus): boolean {
  return status === "waiting" || status === "review";
}
