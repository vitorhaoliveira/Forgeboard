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

/**
 * What a team works on. It changes the words (build or write, merge or accept) and what agents are told.
 * Missing means "code", as before v2.4.
 */
export type WorkKind = "code" | "writing" | "research" | "data" | "other";
export const WORK_KINDS: WorkKind[] = ["code", "writing", "research", "data", "other"];

/** A named group of agents a workspace can use, with the flow its tasks run by default. */
export interface Team {
  id: string;
  name: string;
  description: string;
  /** Flow new tasks run (unless the workspace or the task picks another). */
  planning: string;
  members: Agent[];
  kind?: WorkKind;
  /** What the team works on, in your words. Every member is told. */
  about?: string;
  /** What its builders may run. Missing means "standard". A workspace set to "restricted" always wins. */
  commands?: ForgeCommands;
  /** The template it started from, if any. */
  templateId?: string;
  createdAt: string;
}

export interface CreateTeamInput {
  name: string;
  description?: string;
  /** Start from a template; without one, the team starts as a copy of the default team. */
  templateId?: string;
  locale: Locale;
}

/** A ready-made team. Texts come in each language; picking it makes your own copy. */
export interface TeamTemplate {
  id: string;
  name: Record<Locale, string>;
  description: Record<Locale, string>;
  planning: string;
  kind: WorkKind;
  commands: ForgeCommands;
  members: (Omit<Agent, "instructions" | "builtIn" | "customized"> & { instructions: Record<Locale, string> })[];
  /** Tasks this team is good at, to give an idea. */
  examples: Record<Locale, string[]>;
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
  /** "default": the default team. "custom": its own copy of the agents. "team": one of your teams (teamId). */
  crewMode: "default" | "custom" | "team";
  /** With crewMode "team": the team it uses. */
  teamId?: string;
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
  /** Use one of your teams. */
  teamId?: string | null;
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
  /** Documents (markdown, text): the file as it is now, to show it rendered. */
  preview?: string;
}

const DOCUMENT_EXT = /\.(md|mdx|markdown|txt|text|rst|adoc)$/i;

/** Files shown as a document (rendered) on the review screen. */
export function isDocument(path: string): boolean {
  return DOCUMENT_EXT.test(path);
}

/** Markdown files are rendered; other documents are shown as plain text. */
export function isMarkdown(path: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(path);
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

// ---------- Team templates ----------

const FORGE_T = {
  id: "forge",
  name: "Forge",
  role: "builder" as const,
  provider: "claude-code" as const,
  personality: "balanced" as const,
  instructions: {
    "en-US": "Keep changes small and focused. Follow the conventions already used in the repository.",
    "pt-BR": "Mantenha as mudanças pequenas e focadas. Siga as convenções que o repositório já usa.",
  },
};
const HAWK_T = {
  id: "hawk",
  name: "Hawk",
  role: "reviewer" as const,
  provider: "claude-code" as const,
  personality: "strict" as const,
  instructions: {
    "en-US": "Block on failing checks and on real bugs. Do not nitpick style that a linter would catch.",
    "pt-BR": "Bloqueie verificações falhando e bugs de verdade. Não implique com estilo que um linter pegaria.",
  },
};
const LEAD_T = {
  id: "lead",
  name: "Lead",
  role: "lead" as const,
  provider: "claude-code" as const,
  personality: "balanced" as const,
  instructions: {
    "en-US": "Pick the smallest team that does the task well. Skip the review for trivial changes; add one for anything risky or public.",
    "pt-BR": "Escolha o menor time que faça a tarefa bem. Pule a revisão em mudanças triviais; inclua uma em tudo que for arriscado ou público.",
  },
};

/** Ready-made teams: for code first, then for other kinds of work. */
export const TEAM_TEMPLATES: TeamTemplate[] = [
  {
    id: "build-review",
    name: { "en-US": "Build & Review", "pt-BR": "Construir e revisar" },
    description: {
      "en-US": "Forge builds, Hawk reviews and sends it back until it's right. The classic.",
      "pt-BR": "O Forge constrói, o Hawk revisa e devolve até ficar certo. O clássico.",
    },
    planning: "build-and-review",
    kind: "code",
    commands: "standard",
    members: [FORGE_T, HAWK_T],
    examples: {
      "en-US": ["Add pagination to the users table", "Fix the date shown in the invoice"],
      "pt-BR": ["Adicionar paginação na tabela de usuários", "Corrigir a data mostrada na fatura"],
    },
  },
  {
    id: "product",
    name: { "en-US": "Product team", "pt-BR": "Time de produto" },
    description: {
      "en-US": "A Lead picks who works on each task: Forge builds, Scribe writes the docs, Hawk reviews and Guard checks security.",
      "pt-BR": "Um Lead escolhe quem trabalha em cada tarefa: o Forge constrói, o Scribe escreve a documentação, o Hawk revisa e o Guard cuida da segurança.",
    },
    planning: "lead-decides",
    kind: "code",
    commands: "standard",
    members: [
      LEAD_T,
      FORGE_T,
      {
        id: "scribe",
        name: "Scribe",
        role: "builder",
        provider: "claude-code",
        personality: "mentor",
        instructions: {
          "en-US": "You write the docs: README, guides and comments people read. Explain what changed and how to use it, with short examples. Don't change code.",
          "pt-BR": "Você escreve a documentação: README, guias e comentários que as pessoas leem. Explique o que mudou e como usar, com exemplos curtos. Não mude o código.",
        },
      },
      HAWK_T,
      {
        id: "guard",
        name: "Guard",
        role: "reviewer",
        provider: "claude-code",
        personality: "strict",
        instructions: {
          "en-US": "Review only for security: secrets in code, injection, unsafe input, auth and permission mistakes, risky dependencies. Ignore style.",
          "pt-BR": "Revise só segurança: segredos no código, injeção, entrada insegura, erros de autenticação e permissão, dependências arriscadas. Ignore estilo.",
        },
      },
    ],
    examples: {
      "en-US": ["Add password reset by email", "Document the public API"],
      "pt-BR": ["Adicionar recuperação de senha por e-mail", "Documentar a API pública"],
    },
  },
  {
    id: "quick-fix",
    name: { "en-US": "Quick fix", "pt-BR": "Correção rápida" },
    description: {
      "en-US": "Forge fixes it and the checks confirm it. No review round: for small, low-risk changes.",
      "pt-BR": "O Forge corrige e as verificações confirmam. Sem rodada de revisão: para mudanças pequenas e de baixo risco.",
    },
    planning: "lead-decides",
    kind: "code",
    commands: "standard",
    members: [
      {
        ...LEAD_T,
        instructions: {
          "en-US": "Keep it minimal: Forge and the checks. Add a reviewer only if the change turns out risky.",
          "pt-BR": "Mantenha o mínimo: o Forge e as verificações. Inclua um revisor só se a mudança se mostrar arriscada.",
        },
      },
      FORGE_T,
    ],
    examples: {
      "en-US": ["Fix the typo on the login page", "Update the copyright year"],
      "pt-BR": ["Corrigir o erro de digitação na tela de login", "Atualizar o ano do copyright"],
    },
  },
  {
    id: "test-first",
    name: { "en-US": "Tests first", "pt-BR": "Testes primeiro" },
    description: {
      "en-US": "Probe writes the tests that describe the change, Forge makes them pass, Hawk reviews both.",
      "pt-BR": "O Probe escreve os testes que descrevem a mudança, o Forge faz eles passarem e o Hawk revisa os dois.",
    },
    planning: "lead-decides",
    kind: "code",
    commands: "standard",
    members: [
      {
        ...LEAD_T,
        instructions: {
          "en-US": "Start with Probe writing the tests, then Forge, then the checks; add Hawk for anything beyond a small change.",
          "pt-BR": "Comece com o Probe escrevendo os testes, depois o Forge, depois as verificações; inclua o Hawk em tudo que não for uma mudança pequena.",
        },
      },
      {
        id: "probe",
        name: "Probe",
        role: "builder",
        provider: "claude-code",
        personality: "strict",
        instructions: {
          "en-US": "Write tests only: the cases that describe the requested behavior, including edge cases. Don't implement the feature.",
          "pt-BR": "Escreva só testes: os casos que descrevem o comportamento pedido, incluindo casos de borda. Não implemente a funcionalidade.",
        },
      },
      FORGE_T,
      HAWK_T,
    ],
    examples: {
      "en-US": ["Add discount rules to the cart", "Validate the signup form"],
      "pt-BR": ["Adicionar regras de desconto no carrinho", "Validar o formulário de cadastro"],
    },
  },
];

/** A Lead for a non-code team, told the usual order of its members. */
function leadWith(en: string, pt: string) {
  return { ...LEAD_T, instructions: { "en-US": en, "pt-BR": pt } };
}

function member(id: string, name: string, role: "builder" | "reviewer", personality: Personality, en: string, pt: string) {
  return { id, name, role, provider: "claude-code" as const, personality, instructions: { "en-US": en, "pt-BR": pt } };
}

const FACT_CHECKER = member(
  "fact-checker",
  "Fact-checker",
  "reviewer",
  "strict",
  "Mark every claim without a source, every number that doesn't add up and every quote you can't trace. Never rewrite the text: list what to fix.",
  "Marque toda afirmação sem fonte, todo número que não fecha e toda citação que você não consegue rastrear. Nunca reescreva o texto: liste o que corrigir.",
);

TEAM_TEMPLATES.push(
  {
    id: "docs",
    name: { "en-US": "Docs", "pt-BR": "Documentação" },
    description: {
      "en-US": "Writer writes guides, READMEs and manuals; Editor checks they are clear, correct and consistent.",
      "pt-BR": "O Writer escreve guias, READMEs e manuais; o Editor confere se estão claros, corretos e consistentes.",
    },
    planning: "lead-decides",
    kind: "writing",
    commands: "restricted",
    members: [
      leadWith(
        "Writer writes, then Editor reviews. Skip the review only for a one-line fix.",
        "O Writer escreve, depois o Editor revisa. Pule a revisão só em correções de uma linha.",
      ),
      member(
        "writer",
        "Writer",
        "builder",
        "mentor",
        "Write for someone new to the subject: short sentences, one idea per paragraph, an example for each step. Keep the tone and structure the folder already uses.",
        "Escreva para quem não conhece o assunto: frases curtas, uma ideia por parágrafo, um exemplo para cada passo. Mantenha o tom e a estrutura que a pasta já usa.",
      ),
      member(
        "editor",
        "Editor",
        "reviewer",
        "strict",
        "Check clarity, accuracy and consistency with the other documents: terms, headings, links. Block on anything wrong or confusing; don't rewrite for taste.",
        "Confira clareza, precisão e consistência com os outros documentos: termos, títulos, links. Bloqueie o que estiver errado ou confuso; não reescreva por gosto.",
      ),
    ],
    examples: {
      "en-US": ["Write a getting started guide", "Update the FAQ with the new prices"],
      "pt-BR": ["Escrever um guia de primeiros passos", "Atualizar o FAQ com os novos preços"],
    },
  },
  {
    id: "content",
    name: { "en-US": "Content", "pt-BR": "Conteúdo" },
    description: {
      "en-US": "Blog posts, newsletters and marketing copy. Writer drafts, Editor polishes, Fact-checker checks every claim.",
      "pt-BR": "Posts, newsletters e textos de marketing. O Writer rascunha, o Editor lapida e o Fact-checker confere cada afirmação.",
    },
    planning: "lead-decides",
    kind: "writing",
    commands: "restricted",
    members: [
      leadWith(
        "Writer drafts, then Editor. Add Fact-checker whenever the text has numbers, claims about others or quotes.",
        "O Writer rascunha, depois o Editor. Inclua o Fact-checker sempre que o texto tiver números, afirmações sobre terceiros ou citações.",
      ),
      member(
        "writer",
        "Writer",
        "builder",
        "balanced",
        "Write for the audience in the task: a strong first line, concrete examples, no filler. Save each piece as a markdown file.",
        "Escreva para o público da tarefa: uma primeira frase forte, exemplos concretos, sem enrolação. Salve cada peça como um arquivo markdown.",
      ),
      member(
        "editor",
        "Editor",
        "reviewer",
        "strict",
        "Check tone, structure and length against the brief and the house rules. Point out weak openings, jargon and repetition.",
        "Confira tom, estrutura e tamanho em relação ao pedido e às regras da casa. Aponte aberturas fracas, jargão e repetição.",
      ),
      FACT_CHECKER,
    ],
    examples: {
      "en-US": ["Write a launch post for the new plan", "Draft three subject lines for the newsletter"],
      "pt-BR": ["Escrever o post de lançamento do novo plano", "Rascunhar três assuntos para a newsletter"],
    },
  },
  {
    id: "research",
    name: { "en-US": "Research brief", "pt-BR": "Pesquisa" },
    description: {
      "en-US": "Researcher reads what is in the folder and writes a brief with sources; Fact-checker checks it holds up.",
      "pt-BR": "O Researcher lê o que está na pasta e escreve um resumo com fontes; o Fact-checker confere se ele se sustenta.",
    },
    planning: "lead-decides",
    kind: "research",
    commands: "restricted",
    members: [
      leadWith("Researcher writes the brief, then Fact-checker reviews it.", "O Researcher escreve o resumo, depois o Fact-checker revisa."),
      member(
        "researcher",
        "Researcher",
        "builder",
        "balanced",
        "Answer the question in the task from the material in the folder. Start with the answer, then the evidence, then what is still unknown. Cite the file (and page or section) for every claim.",
        "Responda à pergunta da tarefa a partir do material da pasta. Comece pela resposta, depois as evidências, depois o que ainda não se sabe. Cite o arquivo (e página ou seção) de cada afirmação.",
      ),
      FACT_CHECKER,
    ],
    examples: {
      "en-US": ["Summarize the interviews in /interviews", "Compare the three supplier proposals"],
      "pt-BR": ["Resumir as entrevistas em /entrevistas", "Comparar as três propostas de fornecedores"],
    },
  },
  {
    id: "data",
    name: { "en-US": "Data analysis", "pt-BR": "Análise de dados" },
    description: {
      "en-US": "Analyst explores the data with Python and writes up what it found; Reviewer checks the method and the numbers.",
      "pt-BR": "O Analyst explora os dados com Python e escreve o que encontrou; o Reviewer confere o método e os números.",
    },
    planning: "lead-decides",
    kind: "data",
    commands: "standard",
    members: [
      leadWith("Analyst first, then Reviewer. Add the checks when the folder has tests.", "Primeiro o Analyst, depois o Reviewer. Inclua as verificações quando a pasta tiver testes."),
      member(
        "analyst",
        "Analyst",
        "builder",
        "balanced",
        "Work in scripts or notebooks the user can run again. Never change the raw data files. Write a short report: the question, the method, the results with numbers, and the caveats.",
        "Trabalhe em scripts ou notebooks que a pessoa possa rodar de novo. Nunca altere os arquivos de dados brutos. Escreva um relatório curto: a pergunta, o método, os resultados com números e as ressalvas.",
      ),
      member(
        "reviewer",
        "Reviewer",
        "reviewer",
        "strict",
        "Check that the method answers the question, the numbers in the report match the code, and the caveats are honest. Block on wrong joins, leaks and cherry-picking.",
        "Confira se o método responde à pergunta, se os números do relatório batem com o código e se as ressalvas são honestas. Bloqueie joins errados, vazamentos e escolha seletiva de dados.",
      ),
    ],
    examples: {
      "en-US": ["Which plans churn the most?", "Clean sales.csv and chart revenue by month"],
      "pt-BR": ["Quais planos têm mais cancelamentos?", "Limpar vendas.csv e fazer um gráfico da receita por mês"],
    },
  },
  {
    id: "translation",
    name: { "en-US": "Translation", "pt-BR": "Tradução" },
    description: {
      "en-US": "Translator translates the files, Native reviewer reads them as a native speaker would.",
      "pt-BR": "O Translator traduz os arquivos e o Native reviewer lê como um falante nativo leria.",
    },
    planning: "lead-decides",
    kind: "writing",
    commands: "restricted",
    members: [
      leadWith("Always Translator, then Native reviewer.", "Sempre o Translator, depois o Native reviewer."),
      member(
        "translator",
        "Translator",
        "builder",
        "balanced",
        "Translate meaning, not word by word. Keep formatting, links, code and names as they are. Put each translation next to the original unless the task says where.",
        "Traduza o sentido, não palavra por palavra. Mantenha formatação, links, código e nomes como estão. Coloque cada tradução ao lado do original, a menos que a tarefa diga onde.",
      ),
      member(
        "native",
        "Native reviewer",
        "reviewer",
        "strict",
        "Read the translation as a native speaker: flag anything that sounds translated, wrong terms and missing parts. Compare with the original.",
        "Leia a tradução como um falante nativo: aponte o que soa traduzido, termos errados e partes faltando. Compare com o original.",
      ),
    ],
    examples: {
      "en-US": ["Translate the docs folder to Spanish", "Review the Portuguese version of the onboarding emails"],
      "pt-BR": ["Traduzir a pasta de docs para o espanhol", "Revisar a versão em inglês dos e-mails de boas-vindas"],
    },
  },
);

/** A template's agents in one language, ready to save as a team's members. */
export function templateMembers(template: TeamTemplate, locale: Locale): Agent[] {
  return template.members.map((m) => ({ ...m, instructions: m.instructions[locale] }));
}

