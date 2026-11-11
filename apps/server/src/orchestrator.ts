import { join } from "node:path";
import { nanoid } from "nanoid";
import { compileForm, sanitizeAnswer, validateUi } from "@forgeboard/shared/a2ui";
import { BUILD_AND_REVIEW } from "@forgeboard/shared";
import type {
  Actor,
  Agent,
  AgentForm,
  AgentQuestion,
  CheckResult,
  FormAnswer,
  Locale,
  MessageDelivery,
  Flow,
  FlowNode,
  FlowStep,
  ForgeCommands,
  NodeState,
  RunEventPayload,
  Task,
  TaskStatus,
  Verdict,
} from "@forgeboard/shared";
import { bus } from "./bus.js";
import { runChecks } from "./checks.js";
import { config } from "./config.js";
import { agents, events, repos, rules, tasks, taskState, workspaces } from "./db.js";
import * as git from "./git.js";
import {
  forgeAnswerPrompt,
  forgeFixPrompt,
  forgeMessagesPrompt,
  forgeNotesPrompt,
  forgeStartPrompt,
  type ForgeStyle,
  hawkPrompt,
  messagesNote,
  parseAssumptions,
  parseForm,
  parseQuestion,
  parseVerdict,
  stripQuestion,
} from "./prompts.js";
import { getProvider } from "./providers/index.js";
import { AbortedError, type AgentActivity } from "./providers/types.js";

/**
 * Commands builders may run without asking: package managers (to run tests and builds)
 * and read-only git/file commands. Anything else is refused in headless mode.
 */
const READ_ONLY_COMMANDS = ["ls", "git status", "git diff", "git log"];
const PACKAGE_COMMANDS = ["npm", "pnpm", "yarn", "bun", "npx", "node"];
const asTools = (cmds: string[]) => cmds.flatMap((cmd) => [`Bash(${cmd})`, `Bash(${cmd} *)`]);

/** Shell commands builders may run, by the workspace's setting. File edits are always allowed. */
const BUILDER_ALLOWED_TOOLS: Record<ForgeCommands, string[]> = {
  standard: asTools([...PACKAGE_COMMANDS, ...READ_ONLY_COMMANDS]),
  restricted: asTools(READ_ONLY_COMMANDS),
};

/** Reviewers read files only: no shell and no edits, whatever the model decides. */
const REVIEWER_DISALLOWED_TOOLS = ["Bash", "Edit", "Write", "NotebookEdit"];

/** Abort handles for tasks the server is working on right now. */
const running = new Map<string, AbortController>();

export class FlowError extends Error {}

function emit(taskId: string, payload: RunEventPayload): void {
  const event = { ...payload, taskId, seq: events.lastSeq(taskId) + 1, ts: new Date().toISOString() };
  events.insert(event);
  bus.publish(event);
}

/** Lights a graph node: a step id, or "task" / "you" / "merge". */
function node(taskId: string, n: string, state: NodeState, note?: string): void {
  // Step ids of the built-in flow are the FlowNode names; other flows widen this in v2.0's flow editor.
  emit(taskId, { type: "node", actor: "system", node: n as FlowNode, state, note });
}

function setStatus(taskId: string, status: TaskStatus, patch: Partial<Task> = {}): Task {
  const done = status === "merged" || status === "discarded" || status === "cancelled" || status === "error";
  const task = tasks.update(taskId, { ...patch, status, ...(done ? { finishedAt: new Date().toISOString() } : {}) });
  emit(taskId, { type: "status", actor: "system", status });
  return task;
}

function addCost(taskId: string, cost: number | null): void {
  if (!cost) return;
  const task = tasks.get(taskId)!;
  tasks.update(taskId, { costUsd: task.costUsd + cost });
}

function slug(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32)
      .replace(/-$/, "") || "task"
  );
}

function requireWorktree(taskId: string): { worktree: string; baseSha: string } {
  const state = taskState.get(taskId);
  if (!state.worktreePath || !state.baseSha) throw new FlowError("This task has no worktree.");
  return { worktree: state.worktreePath, baseSha: state.baseSha };
}

function activityEmitter(taskId: string, actor: Actor) {
  return (a: AgentActivity) => emit(taskId, { ...a, actor });
}

// ---------- Steps ----------

type BuilderMode =
  | { kind: "start" }
  | { kind: "answer"; answer: string; form?: AgentForm; data?: FormAnswer; note?: string; replan?: boolean }
  | { kind: "fix" }
  | { kind: "notes"; notes: string }
  /** Only your messages: after an interruption, or when they arrive after a reviewer approved. */
  | { kind: "messages" };

/** Messages you sent while the crew worked, waiting for the next builder step. */
const inbox = new Map<string, string[]>();
/** The builder step running now, so a message can interrupt it. */
const builderSteps = new Map<string, { abort: AbortController; agentId: string }>();

type AgentStep = Extract<FlowStep, { type: "agent" }>;

function takeInbox(taskId: string): string[] {
  const list = inbox.get(taskId) ?? [];
  inbox.delete(taskId);
  return list;
}

function styleFor(workspaceId: string): ForgeStyle {
  const ws = workspaces.get(workspaceId);
  return { askMode: ws?.askMode ?? "ask", planFirst: ws?.planFirst ?? true };
}

/** The flow a task runs. Tasks from before v2.0 have none: they ran Build & Review. */
function flowOf(task: Task): Flow {
  return task.flow ?? BUILD_AND_REVIEW;
}

function isBuilder(task: Task, step: FlowStep): step is AgentStep {
  return step.type === "agent" && agents.forStep(task.workspaceId, step.agentId).role === "builder";
}

/** The step a reviewer sends work back to: its `sendBackTo`, or the closest builder before it. */
function sendBackIndex(task: Task, flow: Flow, reviewerIndex: number): number {
  const step = flow.steps[reviewerIndex] as AgentStep;
  if (step.sendBackTo) return flow.steps.findIndex((s) => s.id === step.sendBackTo);
  for (let i = reviewerIndex - 1; i >= 0; i--) if (isBuilder(task, flow.steps[i]!)) return i;
  return -1;
}

/** The last builder step of a flow: where your notes go after review. */
function lastBuilderId(task: Task, flow: Flow): string {
  const step = [...flow.steps].reverse().find((s) => isBuilder(task, s));
  if (!step) throw new FlowError("This flow has no agent that builds.");
  return step.id;
}

function sessionOf(taskId: string, stepId: string): string | undefined {
  const state = taskState.get(taskId);
  return state.sessions?.[stepId] ?? (stepId === "forge" ? state.forgeSession : undefined);
}

function saveSession(taskId: string, stepId: string, sessionId: string | null | undefined): void {
  const state = taskState.get(taskId);
  const sessions = { ...state.sessions };
  if (sessionId) sessions[stepId] = sessionId;
  else delete sessions[stepId];
  taskState.set(taskId, { sessions });
}

/**
 * Turns a form in a builder's message into a question with A2UI messages. Returns null
 * when there is no form, or when it doesn't pass the catalog (then the text question, if any, is used).
 */
function formQuestion(taskId: string, text: string, locale: Locale): AgentQuestion | null {
  const form = parseForm(text);
  if (!form) return null;
  try {
    const submit = locale === "pt-BR" ? (form.kind === "plan" ? "Aprovar e começar" : "Enviar respostas") : form.kind === "plan" ? "Approve and start" : "Send answers";
    const ui = compileForm(form, `q-${taskId}-${nanoid(6)}`, submit);
    validateUi(ui);
    return { question: form.title, context: form.context, options: [], form, ui };
  } catch (err) {
    console.warn(`[forgeboard] form rejected for ${taskId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Runs a builder step once. Returns "question" when the agent paused to ask the user something. */
async function builderStep(taskId: string, step: AgentStep, mode: BuilderMode, signal: AbortSignal): Promise<"question" | "done"> {
  const task = tasks.get(taskId)!;
  const { worktree } = requireWorktree(taskId);
  const agent = agents.forStep(task.workspaceId, step.agentId);
  const repoRules = rules.forRepo(repos.get(task.repoId)!);
  const commands: ForgeCommands = workspaces.get(task.workspaceId)?.forgeCommands ?? "standard";
  const style = styleFor(task.workspaceId);
  const messages = takeInbox(taskId);

  const base =
    mode.kind === "start"
      ? forgeStartPrompt(agent, task, repoRules, commands, style)
      : mode.kind === "answer"
        ? forgeAnswerPrompt(mode.answer, mode.form, mode.data, mode, style)
        : mode.kind === "fix"
          ? forgeFixPrompt(task, style)
          : mode.kind === "notes"
            ? forgeNotesPrompt(mode.notes, style)
            : forgeMessagesPrompt(messages, style);
  const prompt = mode.kind === "messages" ? base : mode.kind === "start" ? `${base}\n\n${messagesNote(messages)}`.trim() : `${messagesNote(messages)}${base}`;

  node(taskId, step.id, "active");
  // Its own stop handle, so a message can interrupt this step without stopping the task.
  const stepAbort = new AbortController();
  const stopStep = () => stepAbort.abort();
  signal.addEventListener("abort", stopStep, { once: true });
  builderSteps.set(taskId, { abort: stepAbort, agentId: agent.id });
  let output;
  try {
    output = await getProvider(agent.provider).run({
      role: "builder",
      prompt,
      cwd: worktree,
      permissionMode: "acceptEdits",
      allowedTools: BUILDER_ALLOWED_TOOLS[commands],
      commands,
      // Keep the same conversation across rounds so the agent remembers its work.
      resumeSession: mode.kind === "start" ? undefined : sessionOf(taskId, step.id),
      onSession: (id) => saveSession(taskId, step.id, id),
      locale: task.locale,
      round: task.round,
      signal: stepAbort.signal,
      emit: activityEmitter(taskId, agent.id),
    });
  } catch (err) {
    // Interrupted by your message: resume the same session with it.
    if (!signal.aborted && stepAbort.signal.aborted && inbox.get(taskId)?.length) {
      return builderStep(taskId, step, { kind: "messages" }, signal);
    }
    throw err;
  } finally {
    signal.removeEventListener("abort", stopStep);
    if (builderSteps.get(taskId)?.abort === stepAbort) builderSteps.delete(taskId);
  }
  saveSession(taskId, step.id, output.sessionId);
  addCost(taskId, output.costUsd);

  const question = formQuestion(taskId, output.text, task.locale) ?? parseQuestion(output.text);
  if (question) {
    // The provider already streamed the message itself; the UI hides the marker line.
    emit(taskId, { type: "question", actor: agent.id, question: { ...question, askedBy: agent.id } });
    node(taskId, step.id, "warn");
    node(taskId, "you", "active");
    taskState.set(taskId, { resumeStep: step.id });
    setStatus(taskId, "waiting", { question: { ...question, askedBy: agent.id } });
    return "question";
  }

  const assumptions = parseAssumptions(output.text);
  const summary = stripQuestion(output.text);
  // Each list is complete (see forgeEnding), so it replaces the previous one instead of piling up.
  if (assumptions?.length) {
    emit(taskId, { type: "assumptions", actor: agent.id, items: assumptions });
    tasks.update(taskId, { assumptions, assumptionsAck: false });
  } else if (assumptions && tasks.get(taskId)!.assumptions?.length) {
    // An empty list: none of the earlier decisions still hold, so there's nothing left to check.
    tasks.update(taskId, { assumptions: [] });
  }
  emit(taskId, { type: "step_done", actor: agent.id, summary, costUsd: output.costUsd, durationMs: output.durationMs });
  tasks.update(taskId, { summary });
  // Messages sent during this step ("at the next pause") go in now, before checks and review,
  // so the reviewer sees work that already includes them.
  if (inbox.get(taskId)?.length) return builderStep(taskId, step, { kind: "messages" }, signal);
  node(taskId, step.id, "done");
  return "done";
}

async function checksStep(taskId: string, stepId: string, from: Actor, signal: AbortSignal): Promise<CheckResult[]> {
  const task = tasks.get(taskId)!;
  const repo = repos.get(task.repoId)!;
  const { worktree } = requireWorktree(taskId);

  emit(taskId, { type: "handoff", actor: from, to: "checks", label: "" });
  node(taskId, stepId, "active");
  const results = await runChecks(worktree, repo.checks, signal);
  if (signal.aborted) throw new AbortedError();
  emit(taskId, { type: "checks", actor: "checks", results });
  tasks.update(taskId, { checks: results });
  node(taskId, stepId, results.every((r) => r.ok) ? "done" : "failed");
  return results;
}

/** Everything you told the crew after the task started: answers, messages and notes, in order. */
function yourWords(taskId: string): string[] {
  return events
    .list(taskId)
    .filter((e) => e.actor === "you" && (e.type === "answer" || e.type === "message" || e.type === "text"))
    .map((e) => ("text" in e ? e.text : ""))
    .filter((text) => text.trim().length > 0);
}

async function reviewerStep(
  taskId: string,
  step: AgentStep,
  checks: CheckResult[],
  builderName: string,
  signal: AbortSignal,
): Promise<Verdict> {
  const task = tasks.get(taskId)!;
  const { worktree, baseSha } = requireWorktree(taskId);
  const agent = agents.forStep(task.workspaceId, step.agentId);
  const files = await git.diff(worktree, baseSha);

  node(taskId, step.id, "active");
  let verdict: Verdict;
  if (files.length === 0) {
    verdict = {
      approved: false,
      risk: "low",
      summary: task.locale === "pt-BR" ? `O ${builderName} não fez nenhuma mudança.` : `${builderName} didn't change anything.`,
      issues: [],
    };
  } else {
    const diffText = files.map((f) => f.patch).join("");
    const output = await getProvider(agent.provider).run({
      role: "reviewer",
      prompt: hawkPrompt(agent, task, rules.forRepo(repos.get(task.repoId)!), diffText, checks, yourWords(taskId)),
      cwd: worktree,
      permissionMode: "plan",
      // Plan mode alone doesn't stop the model from running commands (it ran `npm test`).
      disallowedTools: REVIEWER_DISALLOWED_TOOLS,
      locale: task.locale,
      round: task.round,
      signal,
      emit: activityEmitter(taskId, agent.id),
    });
    addCost(taskId, output.costUsd);
    const allPassed = checks.every((c) => c.ok);
    verdict = parseVerdict(output.text) ?? {
      approved: allPassed,
      risk: "medium",
      summary: output.text.slice(0, 400),
      issues: [],
    };
    // Never let a failing check through, whatever the model said.
    if (!allPassed) verdict.approved = false;
  }

  verdict.by = agent.id;
  emit(taskId, { type: "verdict", actor: agent.id, verdict, round: task.round });
  tasks.update(taskId, { verdict });
  node(taskId, step.id, verdict.approved ? "done" : "warn");
  return verdict;
}

function nextRound(taskId: string, raiseLimit: boolean): void {
  const task = tasks.get(taskId)!;
  const round = task.round + 1;
  tasks.update(taskId, { round, ...(raiseLimit ? { maxRounds: Math.max(task.maxRounds, round) } : {}) });
  emit(taskId, { type: "round", actor: "system", round });
}

/**
 * Runs the task's flow from one step to the end: builders build, checks run, reviewers send
 * work back to their builder until they approve or rounds run out. Stops early when an agent
 * asks a question. At the end the task waits for you.
 */
async function runFlow(taskId: string, from: string | number, firstMode: BuilderMode, signal: AbortSignal): Promise<void> {
  const start = tasks.get(taskId)!;
  const flow = flowOf(start);
  let i = typeof from === "number" ? from : flow.steps.findIndex((s) => s.id === from);
  if (i === -1) throw new FlowError(`This flow has no step "${String(from)}".`);
  let mode = firstMode;
  // Starting mid-flow (after a pause): the checks and the builder before this point still count.
  let checks: CheckResult[] | null = i > 0 ? start.checks : null;
  const before = flow.steps.slice(0, i).reverse().find((s) => isBuilder(start, s)) as AgentStep | undefined;
  let builder: Agent | null = before ? agents.forStep(start.workspaceId, before.agentId) : null;

  while (i < flow.steps.length) {
    const task = tasks.get(taskId)!;
    const step = flow.steps[i]!;

    if (step.type === "ask") {
      askYou(taskId, step);
      return;
    }

    if (step.type === "checks") {
      checks = await checksStep(taskId, step.id, builder?.id ?? "system", signal);
      i++;
      continue;
    }

    const agent = agents.forStep(task.workspaceId, step.agentId);
    if (agent.role === "builder") {
      if ((await builderStep(taskId, step, mode, signal)) === "question") return;
      builder = agent;
      mode = { kind: "start" };
      i++;
      continue;
    }

    const verdict = await reviewerStep(taskId, step, checks ?? [], builder?.name ?? "Forge", signal);
    const back = sendBackIndex(task, flow, i);
    const current = tasks.get(taskId)!;

    // Messages that arrived while checks or the review ran get one more round, even after approval.
    if (back !== -1 && inbox.get(taskId)?.length) {
      nextRound(taskId, true);
      mode = verdict.approved ? { kind: "messages" } : { kind: "fix" };
      i = back;
      continue;
    }

    const limit = step.maxRounds ?? current.maxRounds;
    if (back !== -1 && !verdict.approved && current.round < limit) {
      const count = verdict.issues.length + (checks ?? []).filter((c) => !c.ok).length;
      const target = flow.steps[back] as AgentStep;
      emit(taskId, { type: "handoff", actor: agent.id, to: target.agentId, label: String(count), fromStep: step.id, toStep: target.id });
      nextRound(taskId, false);
      mode = { kind: "fix" };
      i = back;
      continue;
    }
    i++;
  }

  node(taskId, "you", "active");
  setStatus(taskId, "review");
}

const CONTINUE = { "pt-BR": "Continuar", "en-US": "Continue" } as const;

/** An "Ask me" step: the run pauses until you continue or send a note back. */
function askYou(taskId: string, step: Extract<FlowStep, { type: "ask" }>): void {
  const task = tasks.get(taskId)!;
  const pt = task.locale === "pt-BR";
  const question: AgentQuestion = {
    question: step.note?.trim() || (pt ? "Pausa para você conferir antes de seguir." : "Paused for you to check before going on."),
    context: pt ? "Continue, ou escreva o que mudar: volta para quem construiu." : "Continue, or write what to change: it goes back to whoever built it.",
    options: [CONTINUE[task.locale]],
    suggested: 0,
    gate: true,
  };
  node(taskId, step.id, "active");
  emit(taskId, { type: "question", actor: "system", question });
  node(taskId, "you", "active");
  taskState.set(taskId, { resumeStep: step.id });
  setStatus(taskId, "waiting", { question });
}

/** Runs work in the background with a stop handle, turning failures into task states. */
function drive(taskId: string, work: (signal: AbortSignal) => Promise<void>): void {
  const controller = new AbortController();
  running.set(taskId, controller);
  void (async () => {
    try {
      await work(controller.signal);
    } catch (err) {
      if (controller.signal.aborted || err instanceof AbortedError) {
        await cleanup(taskId);
        setStatus(taskId, "cancelled");
      } else {
        const message = err instanceof Error ? err.message : String(err);
        emit(taskId, { type: "error", actor: "system", message });
        setStatus(taskId, "error", { error: message });
      }
    } finally {
      running.delete(taskId);
    }
  })();
}

async function cleanup(taskId: string): Promise<void> {
  const task = tasks.get(taskId)!;
  const repo = repos.get(task.repoId);
  const { worktreePath } = taskState.get(taskId);
  if (!repo) return;
  if (worktreePath) await git.removeWorktree(repo.path, worktreePath);
  if (task.branch) await git.deleteBranch(repo.path, task.branch);
  taskState.set(taskId, { worktreePath: undefined });
}

// ---------- Public actions ----------

export function startTask(taskId: string): void {
  drive(taskId, async (signal) => {
    const task = setStatus(taskId, "running");
    const repo = repos.get(task.repoId)!;
    node(taskId, "task", "done");

    const baseBranch = await git.currentBranch(repo.path);
    const baseSha = await git.headSha(repo.path);
    const branch = `fb/${slug(task.title)}-${task.id.slice(0, 5).toLowerCase()}`;
    const worktreePath = join(config.worktreesDir, task.id);
    await git.createWorktree(repo.path, branch, worktreePath, baseSha);
    taskState.set(taskId, { worktreePath, baseSha });
    // Copy the flow now, so editing it later doesn't change a task that already started.
    const flow = flowOf(task);
    tasks.update(taskId, { branch, baseBranch, round: 1, flow });
    emit(taskId, { type: "round", actor: "system", round: 1 });

    await runFlow(taskId, flow.steps[0]!.id, { kind: "start" }, signal);
  });
}

export function answerQuestion(
  taskId: string,
  answer: string,
  remember: boolean,
  rawData?: unknown,
  extra: { note?: string; replan?: boolean } = {},
): void {
  const task = tasks.get(taskId);
  if (!task || task.status !== "waiting" || !task.question) throw new FlowError("This task isn't waiting for an answer.");
  if (task.question.gate) return answerGate(task, answer);
  const form = task.question.form;
  const replan = Boolean(form && extra.replan);
  // A reply typed in the conversation (no form data) goes to Forge as free text.
  const data = form && !replan && rawData !== undefined ? sanitizeAnswer(form, rawData) : undefined;

  emit(taskId, { type: "answer", actor: "you", text: answer, remember, ...(data ? { data } : {}), ...(extra.note ? { note: extra.note } : {}), ...(replan ? { replan } : {}) });
  if (remember && !replan) {
    // A form becomes one rule per decision; plans are specific to this task, so they're never remembered.
    const texts = form && data
      ? form.fields
          .filter((f) => f.type !== "steps")
          .map((f) => {
            const v = data![f.id];
            const shown = typeof v === "boolean" ? (v ? (task.locale === "pt-BR" ? "sim" : "yes") : task.locale === "pt-BR" ? "não" : "no") : Array.isArray(v) ? (v as string[]).join(", ") : String(v);
            return shown ? `${f.label} → ${shown}` : "";
          })
          .filter(Boolean)
      : [`${task.question.question} → ${answer}`];
    for (const text of texts) {
      rules.save({
        id: nanoid(10),
        scope: "repo",
        workspaceId: null,
        repoId: task.repoId,
        text,
        enabled: true,
        source: "answer",
        createdAt: new Date().toISOString(),
      });
    }
  }
  node(taskId, "you", "done");
  setStatus(taskId, "running", { question: null });
  const fromStep = taskState.get(taskId).resumeStep ?? lastBuilderId(task, flowOf(task));
  drive(taskId, (signal) =>
    runFlow(taskId, fromStep, { kind: "answer", answer, form: data || replan ? form : undefined, data, note: extra.note, replan }, signal),
  );
}

/** Your reply at an "Ask me" step: its first option continues the flow; anything else is a note for the builder before it. */
function answerGate(task: Task, answer: string): void {
  const taskId = task.id;
  const flow = flowOf(task);
  const gateId = taskState.get(taskId).resumeStep;
  const gate = flow.steps.findIndex((s) => s.id === gateId);
  if (gate === -1) throw new FlowError("This task isn't paused at a step of its flow.");
  const proceed = answer.trim().toLowerCase() === (task.question?.options[0] ?? "").toLowerCase();

  emit(taskId, { type: "answer", actor: "you", text: answer, remember: false });
  node(taskId, "you", "done");
  if (proceed) {
    node(taskId, gateId!, "done");
    setStatus(taskId, "running", { question: null });
    drive(taskId, (signal) => runFlow(taskId, gate + 1, { kind: "start" }, signal));
    return;
  }
  const back = flow.steps.slice(0, gate).map((s, i) => [s, i] as const).reverse().find(([s]) => isBuilder(task, s));
  if (!back) throw new FlowError("There's no agent before this pause to send the note to.");
  node(taskId, gateId!, "warn");
  nextRound(taskId, true);
  setStatus(taskId, "running", { question: null });
  drive(taskId, (signal) => runFlow(taskId, back[1], { kind: "notes", notes: answer }, signal));
}

/**
 * A message from you, whatever the task is doing:
 * - waiting for an answer: it is the answer;
 * - waiting for review: it sends the work back with it as notes;
 * - running: it reaches the builder now (interrupting its step) or at its next step.
 */
export function sendMessage(taskId: string, text: string, delivery: MessageDelivery): void {
  const task = tasks.get(taskId);
  if (!task) throw new FlowError("Task not found.");
  if (task.status === "waiting") return answerQuestion(taskId, text, false);
  if (task.status === "review") return sendBack(taskId, text);
  if (task.status !== "running") throw new FlowError("This task has finished. Start a new one to keep going.");

  // "Now" only interrupts while a builder is working; during checks or review it waits for the next builder step.
  const step = builderSteps.get(taskId);
  const interrupts = delivery === "now" && step !== undefined && !step.abort.signal.aborted;
  emit(taskId, { type: "message", actor: "you", text, delivery: interrupts ? "now" : "later" });
  inbox.set(taskId, [...(inbox.get(taskId) ?? []), text]);
  if (interrupts) {
    emit(taskId, { type: "steer", actor: "system", agentId: step.agentId });
    step.abort.abort();
  }
}

export function ackAssumptions(taskId: string): Task {
  if (!tasks.get(taskId)) throw new FlowError("Task not found.");
  return tasks.update(taskId, { assumptionsAck: true });
}

export function sendBack(taskId: string, notes: string): void {
  const task = tasks.get(taskId);
  if (!task || task.status !== "review") throw new FlowError("Only tasks waiting for review can be sent back.");

  emit(taskId, { type: "text", actor: "you", text: notes });
  nextRound(taskId, true);
  node(taskId, "you", "done");
  setStatus(taskId, "running");
  const fromStep = lastBuilderId(task, flowOf(task));
  drive(taskId, (signal) => runFlow(taskId, fromStep, { kind: "notes", notes }, signal));
}

export async function mergeTask(taskId: string, exclude: string[]): Promise<Task> {
  const task = tasks.get(taskId);
  if (!task || task.status !== "review") throw new FlowError("Only tasks waiting for review can be merged.");
  const repo = repos.get(task.repoId)!;
  const { worktree, baseSha } = requireWorktree(taskId);

  if (exclude.length) await git.restoreFiles(worktree, baseSha, exclude);
  await git.commit(worktree, task.title);
  await git.merge(repo.path, task.branch!, task.baseBranch!);
  await cleanup(taskId);

  node(taskId, "you", "done");
  node(taskId, "merge", "done");
  emit(taskId, { type: "merged", actor: "you", branch: task.branch! });
  return setStatus(taskId, "merged");
}

export async function discardTask(taskId: string): Promise<Task> {
  const task = tasks.get(taskId);
  if (!task) throw new FlowError("Task not found.");
  const controller = running.get(taskId);
  if (controller) {
    controller.abort();
    // Wait for the running step to stop before removing its worktree.
    for (let i = 0; i < 100 && running.has(taskId); i++) await new Promise((r) => setTimeout(r, 100));
  }
  await cleanup(taskId);
  return setStatus(taskId, "discarded");
}

export function stopTask(taskId: string): boolean {
  const controller = running.get(taskId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export async function taskDiff(taskId: string) {
  const state = taskState.get(taskId);
  if (!state.worktreePath || !state.baseSha) return [];
  return git.diff(state.worktreePath, state.baseSha);
}
