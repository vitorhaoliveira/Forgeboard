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

/** "forge" and "hawk" are the built-in agents; agents you create get a generated id. */
export type AgentId = string;
/** Who did something in a run: an agent's id, or one of these. */
export type Actor = AgentId | "checks" | "you" | "system";
export const BUILT_IN_AGENT_IDS = ["forge", "hawk", "lead"] as const;
export const SYSTEM_ACTORS = ["checks", "you", "system"] as const;
export const MAX_AGENTS = 12;

export type Personality = "mentor" | "balanced" | "strict";

/**
 * What an agent may do: a builder edits files in the worktree, a reviewer only reads,
 * a lead only reads and plans which teammates work on a task.
 */
export type AgentRole = "builder" | "reviewer" | "lead";

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

/** A node of the run graph: "task", a step id of the task's flow, "you" or "merge". */
export type FlowNode = string;
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
  /** Forge, Hawk and Lead: can be edited but not deleted, and their role is fixed. */
  builtIn?: boolean;
}

export interface CreateAgentInput {
  name: string;
  /** Agents you create build or review; the Lead is built in. */
  role: Exclude<AgentRole, "lead">;
  provider: ProviderId;
  personality: Personality;
  instructions?: string;
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
  | { id: string; type: "checks" }
  /** Pauses and shows what was done so far: you continue, or send a note to the builder before it. */
  | { id: string; type: "ask"; note?: string }
  /**
   * A lead plans the rest of the flow when the task starts. A flow with a lead step has only that step;
   * the task's copy of the flow gets the planned steps after it.
   */
  | { id: string; type: "lead"; agentId: AgentId };

export type FlowStepType = FlowStep["type"];
export const MAX_FLOW_STEPS = 12;
export const MAX_FLOW_ROUNDS = 5;

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
export const LEAD_DECIDES_ID = "lead-decides";

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

/** The Lead reads each task and picks the teammates it needs. */
export const LEAD_DECIDES: Flow = {
  id: LEAD_DECIDES_ID,
  name: "Lead decides",
  description: "The Lead reads the task and picks who builds, who reviews and whether the checks run.",
  builtIn: true,
  steps: [{ id: "lead", type: "lead", agentId: "lead" }],
};

/** What a lead planned for a task, with one line on why for each step. */
export interface LeadPlan {
  by: AgentId;
  summary: string;
  /** Why each planned step is there, by step id. */
  reasons: Record<string, string>;
  /** How many times you asked for another plan. */
  revisions: number;
}

export const MAX_PLAN_REVISIONS = 5;

/** Problems that stop a flow from running, as message keys with values (the UI translates them). */
export type FlowProblem =
  | { code: "name" }
  | { code: "empty" }
  | { code: "tooMany"; max: number }
  | { code: "duplicateId"; step: string }
  | { code: "firstNotBuilder" }
  | { code: "unknownAgent"; step: string; agentId: string }
  | { code: "sendBackNotBuilder"; step: string }
  | { code: "builderSendBack"; step: string }
  | { code: "rounds"; step: string; max: number }
  /** A lead step must be the flow's only step: the lead plans the rest. */
  | { code: "leadAlone" }
  /** A lead step needs an agent whose role is lead, and only a lead step may use one. */
  | { code: "leadRole"; step: string };

/**
 * Checks a flow can run. `roleOf` gives the role of an agent of the crew that will run it
 * (undefined when the crew has no such agent).
 */
export function validateFlow(flow: Pick<Flow, "name" | "steps">, roleOf: (agentId: AgentId) => AgentRole | undefined): FlowProblem[] {
  const problems: FlowProblem[] = [];
  if (!flow.name.trim()) problems.push({ code: "name" });
  if (flow.steps.length === 0) return [...problems, { code: "empty" }];
  if (flow.steps.length > MAX_FLOW_STEPS) problems.push({ code: "tooMany", max: MAX_FLOW_STEPS });
  const seen = new Set<string>();
  flow.steps.forEach((step, i) => {
    if (seen.has(step.id)) problems.push({ code: "duplicateId", step: step.id });
    seen.add(step.id);
    if (step.type === "lead") {
      if (i !== 0 || flow.steps.length > 1) problems.push({ code: "leadAlone" });
      const role = roleOf(step.agentId);
      if (!role) problems.push({ code: "unknownAgent", step: step.id, agentId: step.agentId });
      else if (role !== "lead") problems.push({ code: "leadRole", step: step.id });
      return;
    }
    if (step.type !== "agent") {
      if (i === 0) problems.push({ code: "firstNotBuilder" });
      return;
    }
    const role = roleOf(step.agentId);
    if (!role) {
      problems.push({ code: "unknownAgent", step: step.id, agentId: step.agentId });
      return;
    }
    if (role === "lead") {
      problems.push({ code: "leadRole", step: step.id });
      return;
    }
    if (i === 0 && role !== "builder") problems.push({ code: "firstNotBuilder" });
    if (role === "builder" && step.sendBackTo) problems.push({ code: "builderSendBack", step: step.id });
    if (role === "reviewer") {
      if (step.sendBackTo) {
        const target = flow.steps.findIndex((s) => s.id === step.sendBackTo);
        const t = flow.steps[target];
        if (target === -1 || target >= i || t?.type !== "agent" || roleOf(t.agentId) !== "builder") {
          problems.push({ code: "sendBackNotBuilder", step: step.id });
        }
      }
      if (step.maxRounds !== undefined && (step.maxRounds < 1 || step.maxRounds > MAX_FLOW_ROUNDS || !Number.isInteger(step.maxRounds))) {
        problems.push({ code: "rounds", step: step.id, max: MAX_FLOW_ROUNDS });
      }
    }
  });
  return problems;
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
  /** Flow new tasks run unless you pick another. Missing means Build & Review. */
  defaultFlowId?: string;
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
  /** The reviewer that gave it. Missing on verdicts from before v2.0 (Hawk). */
  by?: AgentId;
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
  /** The agent that asked. Missing on questions from before v2.0 (Forge) and on "Ask me" pauses. */
  askedBy?: AgentId;
  /** An "Ask me" step of the flow: the first option continues, anything else goes back as a note. */
  gate?: boolean;
  /** The Lead's plan, waiting for you: the first option approves it, anything else asks for another plan. */
  planApproval?: boolean;
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
  /** With a lead: what it planned and why. */
  plan?: LeadPlan;
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
  /** Work passing on. A reviewer's hand-back also names the steps (missing before v2.0.1). */
  | WithActor<{ type: "handoff"; to: Actor; label: string; fromStep?: string; toStep?: string }>
  | WithActor<{ type: "step_done"; summary: string; costUsd: number | null; durationMs: number | null }>
  | WithActor<{ type: "merged"; branch: string }>
  /** A message you sent while the crew worked. */
  | WithActor<{ type: "message"; text: string; delivery: MessageDelivery }>
  /** A builder stopped its step to read your message and resumed the same session. Missing agentId: Forge (before v2.0). */
  | WithActor<{ type: "steer"; agentId?: AgentId }>
  /** The lead's plan: the steps it picked, with why. */
  | WithActor<{ type: "plan"; summary: string; steps: FlowStep[]; reasons: Record<string, string> }>
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
  /** Missing means the workspace's default flow. */
  flowId?: string;
}

/** A flow you make: everything but the id and the built-in flag. */
export type FlowInput = Pick<Flow, "name" | "description" | "steps">;

/** One folder in the folder picker. */
export interface FolderEntry {
  name: string;
  path: string;
  /** Has a .git inside: it can be added as a repository. */
  isRepo: boolean;
  /** Already belongs to a workspace. */
  added: boolean;
}

/** A folder's subfolders, for picking a repository without typing its path. */
export interface FolderListing {
  path: string;
  /** Null at the filesystem root. */
  parent: string | null;
  home: string;
  isRepo: boolean;
  added: boolean;
  entries: FolderEntry[];
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
