/**
 * Types shared by the local server and the web UI.
 *
 * A task runs a flow: a list of steps (agents, checks) that ends with you deciding (merge / discard).
 * The built-in flow is "Build & Review":
 *   your task → Forge (builds) → Checks (tests/lint/types) → Hawk (reviews)
 *   → back to Forge until Hawk approves or rounds run out → you decide.
 * Agents can pause the run to ask you a question.
 */

export type ProviderId = "claude-code" | "codex" | "mock";

export type Locale = "en-US" | "pt-BR";
export const LOCALES: Locale[] = ["en-US", "pt-BR"];
export const DEFAULT_LOCALE: Locale = "en-US";

export type AgentId = "forge" | "hawk";
export type Actor = AgentId | "checks" | "you" | "system";

export type Personality = "mentor" | "balanced" | "strict";

/** What an agent may do: a builder edits files in the worktree, a reviewer only reads. */
export type AgentRole = "builder" | "reviewer";

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
  role: AgentRole;
  provider: ProviderId;
  personality: Personality;
  /** Extra instructions added to the agent's prompt. */
  instructions: string;
  /** In a workspace with its own crew: true when this agent differs from the default. */
  customized?: boolean;
}

/** One step of a flow. Step ids are unique inside a flow and name the graph node. */
export type FlowStep =
  | {
      id: string;
      type: "agent";
      agentId: AgentId;
      /** Reviewers only: the builder step that gets the work back when changes are requested. */
      sendBackTo?: string;
      /** Reviewers only: rounds before the work goes to you anyway. Missing means the task's maxRounds. */
      maxRounds?: number;
    }
  | { id: string; type: "checks" };

/** A list of steps a task runs, in order. It always ends with you deciding. */
export interface Flow {
  id: string;
  name: string;
  description: string;
  steps: FlowStep[];
  /** Built-in flows can't be edited or deleted. */
  builtIn?: boolean;
}

export const BUILD_AND_REVIEW_ID = "build-and-review";

/**
 * The v1 flow as data. Its step ids match the old graph nodes, so tasks
 * created before flows existed read the same way.
 */
export const BUILD_AND_REVIEW: Flow = {
  id: BUILD_AND_REVIEW_ID,
  name: "Build & Review",
  description: "Forge builds, the checks run, Hawk reviews and sends it back until it's right.",
  builtIn: true,
  steps: [
    { id: "forge", type: "agent", agentId: "forge" },
    { id: "checks", type: "checks" },
    { id: "hawk", type: "agent", agentId: "hawk", sendBackTo: "forge" },
  ],
};

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
/**
 * What Forge may run in a workspace. "standard": package managers and node (to install and test),
 * which in practice can run any code. "restricted": file edits only; Forgeboard runs the checks.
 */
export type ForgeCommands = "standard" | "restricted";

/** What agents do when a decision isn't clear: stop and ask, or decide and report it. */
export type AskMode = "ask" | "decide";

/** How a message reaches an agent that is working: interrupt the current step, or wait for its end. */
export type MessageDelivery = "now" | "later";

export interface Workspace {
  id: string;
  name: string;
  description: string;
  color: WorkspaceColor;
  /** "default" uses the default crew; "custom" keeps its own agent settings. */
  crewMode: "default" | "custom";
  /** Missing on workspaces created before v1.7.1, which means "standard". */
  forgeCommands?: ForgeCommands;
  /** Missing means "ask" (the behavior before v1.9). */
  askMode?: AskMode;
  /** Ask for an editable plan before big tasks. Missing means true. */
  planFirst?: boolean;
  /** Default delivery for messages sent while an agent works. Missing means "now". */
  messageDelivery?: MessageDelivery;
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

export type FormFieldType = "choice" | "multi" | "toggle" | "text" | "steps";

export interface PlanStep {
  text: string;
  estimate?: string;
  included?: boolean;
}

/** One input of a form an agent asks the user to fill. */
export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  hint?: string;
  options?: string[];
  /** For "choice": index of the option the agent recommends. */
  suggested?: number;
  value?: string | boolean | string[] | PlanStep[];
  mono?: boolean;
}

/**
 * A form an agent wants answered: several questions at once, or a plan to approve.
 * The server compiles it to A2UI messages for the browser to render.
 */
export interface AgentForm {
  kind: "questions" | "plan";
  title: string;
  context?: string;
  fields: FormField[];
  submitLabel?: string;
}

export type FormAnswer = Record<string, string | boolean | string[] | PlanStep[]>;

export interface AgentQuestion {
  question: string;
  context?: string;
  options: string[];
  /** Index into options. */
  suggested?: number;
  /** Present when the agent asked with a form. */
  form?: AgentForm;
  /** The form compiled to A2UI v0.9 messages, validated against Forgeboard's catalog. */
  ui?: unknown[];
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
  /** The flow this task runs, copied when it starts so later edits don't change it. Missing means Build & Review. */
  flow?: Flow;
  branch: string | null;
  baseBranch: string | null;
  question: AgentQuestion | null;
  verdict: Verdict | null;
  checks: CheckResult[] | null;
  /** What Forge said it did in its last round. */
  summary: string | null;
  /** Decisions Forge made on its own in "decide" mode, for you to check. */
  assumptions?: string[];
  /** True once you looked at the assumptions ("Looks good"). */
  assumptionsAck?: boolean;
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
  | WithActor<{ type: "answer"; text: string; remember: boolean; data?: FormAnswer; note?: string; replan?: boolean }>
  | WithActor<{ type: "handoff"; to: Actor; label: string }>
  | WithActor<{ type: "step_done"; summary: string; costUsd: number | null; durationMs: number | null }>
  | WithActor<{ type: "merged"; branch: string }>
  /** A message you sent while the crew worked. */
  | WithActor<{ type: "message"; text: string; delivery: MessageDelivery }>
  /** Forge stopped its step to read your message and resumed the same session. */
  | WithActor<{ type: "steer" }>
  /** Decisions Forge made without asking ("decide" mode). */
  | WithActor<{ type: "assumptions"; items: string[] }>
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
