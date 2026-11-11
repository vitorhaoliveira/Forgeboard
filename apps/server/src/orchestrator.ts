import { join } from "node:path";
import { nanoid } from "nanoid";
import { compileForm, sanitizeAnswer, validateUi } from "@forgeboard/shared/a2ui";
import type {
  Actor,
  AgentForm,
  AgentQuestion,
  CheckResult,
  FormAnswer,
  Locale,
  MessageDelivery,
  FlowNode,
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
 * Commands Forge may run without asking: package managers (to run tests and builds)
 * and read-only git/file commands. Anything else is refused in headless mode.
 */
const READ_ONLY_COMMANDS = ["ls", "git status", "git diff", "git log"];
const PACKAGE_COMMANDS = ["npm", "pnpm", "yarn", "bun", "npx", "node"];
const asTools = (cmds: string[]) => cmds.flatMap((cmd) => [`Bash(${cmd})`, `Bash(${cmd} *)`]);

/** Shell commands Forge may run, by the workspace's setting. File edits are always allowed. */
const FORGE_ALLOWED_TOOLS: Record<ForgeCommands, string[]> = {
  standard: asTools([...PACKAGE_COMMANDS, ...READ_ONLY_COMMANDS]),
  restricted: asTools(READ_ONLY_COMMANDS),
};

/** Hawk reads files only: no shell and no edits, whatever the model decides. */
const HAWK_DISALLOWED_TOOLS = ["Bash", "Edit", "Write", "NotebookEdit"];

/** Abort handles for tasks the server is working on right now. */
const running = new Map<string, AbortController>();

export class FlowError extends Error {}

function emit(taskId: string, payload: RunEventPayload): void {
  const event = { ...payload, taskId, seq: events.lastSeq(taskId) + 1, ts: new Date().toISOString() };
  events.insert(event);
  bus.publish(event);
}

function node(taskId: string, n: FlowNode, state: NodeState, note?: string): void {
  emit(taskId, { type: "node", actor: "system", node: n, state, note });
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

type ForgeMode =
  | { kind: "start" }
  | { kind: "answer"; answer: string; form?: AgentForm; data?: FormAnswer; note?: string; replan?: boolean }
  | { kind: "fix" }
  | { kind: "notes"; notes: string }
  /** Only your messages: after an interruption, or when they arrive after Hawk approved. */
  | { kind: "messages" };

/** Messages you sent while the crew worked, waiting for Forge's next step. */
const inbox = new Map<string, string[]>();
/** The Forge step running now, so a message can interrupt it. */
const forgeSteps = new Map<string, AbortController>();

function takeInbox(taskId: string): string[] {
  const list = inbox.get(taskId) ?? [];
  inbox.delete(taskId);
  return list;
}

function styleFor(workspaceId: string): ForgeStyle {
  const ws = workspaces.get(workspaceId);
  return { askMode: ws?.askMode ?? "ask", planFirst: ws?.planFirst ?? true };
}

/**
 * Turns a form in Forge's message into a question with A2UI messages. Returns null
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

/** Runs Forge once. Returns "question" when Forge paused to ask the user something. */
async function forgeStep(taskId: string, mode: ForgeMode, signal: AbortSignal): Promise<"question" | "done"> {
  const task = tasks.get(taskId)!;
  const { worktree } = requireWorktree(taskId);
  const agent = agents.get(task.workspaceId, "forge");
  const repoRules = rules.forRepo(repos.get(task.repoId)!);
  const state = taskState.get(taskId);
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

  node(taskId, "forge", "active");
  // Its own stop handle, so a message can interrupt this step without stopping the task.
  const step = new AbortController();
  const stopStep = () => step.abort();
  signal.addEventListener("abort", stopStep, { once: true });
  forgeSteps.set(taskId, step);
  let output;
  try {
    output = await getProvider(agent.provider).run({
      role: "forge",
      prompt,
      cwd: worktree,
      permissionMode: "acceptEdits",
      allowedTools: FORGE_ALLOWED_TOOLS[commands],
      commands,
      // Keep the same conversation across rounds so Forge remembers its work.
      resumeSession: mode.kind === "start" ? undefined : state.forgeSession,
      onSession: (id) => taskState.set(taskId, { forgeSession: id }),
      locale: task.locale,
      round: task.round,
      signal: step.signal,
      emit: activityEmitter(taskId, "forge"),
    });
  } catch (err) {
    // Interrupted by your message: resume the same session with it.
    if (!signal.aborted && step.signal.aborted && inbox.get(taskId)?.length) {
      return forgeStep(taskId, { kind: "messages" }, signal);
    }
    throw err;
  } finally {
    signal.removeEventListener("abort", stopStep);
    if (forgeSteps.get(taskId) === step) forgeSteps.delete(taskId);
  }
  taskState.set(taskId, { forgeSession: output.sessionId ?? undefined });
  addCost(taskId, output.costUsd);

  const question = formQuestion(taskId, output.text, task.locale) ?? parseQuestion(output.text);
  if (question) {
    // The provider already streamed the message itself; the UI hides the marker line.
    emit(taskId, { type: "question", actor: "forge", question });
    node(taskId, "forge", "warn");
    node(taskId, "you", "active");
    setStatus(taskId, "waiting", { question });
    return "question";
  }

  const assumptions = parseAssumptions(output.text);
  const summary = stripQuestion(output.text);
  // Each list is complete (see forgeEnding), so it replaces the previous one instead of piling up.
  if (assumptions?.length) {
    emit(taskId, { type: "assumptions", actor: "forge", items: assumptions });
    tasks.update(taskId, { assumptions, assumptionsAck: false });
  } else if (assumptions && tasks.get(taskId)!.assumptions?.length) {
    // An empty list: none of the earlier decisions still hold, so there's nothing left to check.
    tasks.update(taskId, { assumptions: [] });
  }
  emit(taskId, { type: "step_done", actor: "forge", summary, costUsd: output.costUsd, durationMs: output.durationMs });
  tasks.update(taskId, { summary });
  // Messages sent during this step ("at the next pause") go in now, before checks and review,
  // so Hawk reviews work that already includes them.
  if (inbox.get(taskId)?.length) return forgeStep(taskId, { kind: "messages" }, signal);
  node(taskId, "forge", "done");
  return "done";
}

async function checksStep(taskId: string, signal: AbortSignal): Promise<CheckResult[]> {
  const task = tasks.get(taskId)!;
  const repo = repos.get(task.repoId)!;
  const { worktree } = requireWorktree(taskId);

  emit(taskId, { type: "handoff", actor: "forge", to: "checks", label: "" });
  node(taskId, "checks", "active");
  const results = await runChecks(worktree, repo.checks, signal);
  if (signal.aborted) throw new AbortedError();
  emit(taskId, { type: "checks", actor: "checks", results });
  tasks.update(taskId, { checks: results });
  node(taskId, "checks", results.every((r) => r.ok) ? "done" : "failed");
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

async function hawkStep(taskId: string, checks: CheckResult[], signal: AbortSignal): Promise<Verdict> {
  const task = tasks.get(taskId)!;
  const { worktree, baseSha } = requireWorktree(taskId);
  const agent = agents.get(task.workspaceId, "hawk");
  const files = await git.diff(worktree, baseSha);

  node(taskId, "hawk", "active");
  let verdict: Verdict;
  if (files.length === 0) {
    verdict = {
      approved: false,
      risk: "low",
      summary: task.locale === "pt-BR" ? "O Forge não fez nenhuma mudança." : "Forge didn't change anything.",
      issues: [],
    };
  } else {
    const diffText = files.map((f) => f.patch).join("");
    const output = await getProvider(agent.provider).run({
      role: "hawk",
      prompt: hawkPrompt(agent, task, rules.forRepo(repos.get(task.repoId)!), diffText, checks, yourWords(taskId)),
      cwd: worktree,
      permissionMode: "plan",
      // Plan mode alone doesn't stop the model from running commands (it ran `npm test`).
      disallowedTools: HAWK_DISALLOWED_TOOLS,
      locale: task.locale,
      round: task.round,
      signal,
      emit: activityEmitter(taskId, "hawk"),
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

  emit(taskId, { type: "verdict", actor: "hawk", verdict, round: task.round });
  tasks.update(taskId, { verdict });
  node(taskId, "hawk", verdict.approved ? "done" : "warn");
  return verdict;
}

/** Forge → checks → Hawk, repeated until approval, a question, or the round limit. */
async function loop(taskId: string, first: ForgeMode, signal: AbortSignal): Promise<void> {
  let mode = first;
  for (;;) {
    if ((await forgeStep(taskId, mode, signal)) === "question") return;
    const checks = await checksStep(taskId, signal);
    const verdict = await hawkStep(taskId, checks, signal);
    const task = tasks.get(taskId)!;

    // Messages that arrived while checks or Hawk ran get one more Forge round, even after approval.
    if (inbox.get(taskId)?.length) {
      tasks.update(taskId, { round: task.round + 1, maxRounds: Math.max(task.maxRounds, task.round + 1) });
      emit(taskId, { type: "round", actor: "system", round: task.round + 1 });
      mode = verdict.approved ? { kind: "messages" } : { kind: "fix" };
      continue;
    }

    if (verdict.approved || task.round >= task.maxRounds) {
      node(taskId, "you", "active");
      setStatus(taskId, "review");
      return;
    }

    const count = verdict.issues.length + checks.filter((c) => !c.ok).length;
    emit(taskId, { type: "handoff", actor: "hawk", to: "forge", label: String(count) });
    tasks.update(taskId, { round: task.round + 1 });
    emit(taskId, { type: "round", actor: "system", round: task.round + 1 });
    mode = { kind: "fix" };
  }
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
    tasks.update(taskId, { branch, baseBranch, round: 1 });
    emit(taskId, { type: "round", actor: "system", round: 1 });

    await loop(taskId, { kind: "start" }, signal);
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
  drive(taskId, (signal) => loop(taskId, { kind: "answer", answer, form: data || replan ? form : undefined, data, note: extra.note, replan }, signal));
}

/**
 * A message from you, whatever the task is doing:
 * - waiting for an answer: it is the answer;
 * - waiting for review: it sends the work back with it as notes;
 * - running: it reaches Forge now (interrupting its step) or at its next step.
 */
export function sendMessage(taskId: string, text: string, delivery: MessageDelivery): void {
  const task = tasks.get(taskId);
  if (!task) throw new FlowError("Task not found.");
  if (task.status === "waiting") return answerQuestion(taskId, text, false);
  if (task.status === "review") return sendBack(taskId, text);
  if (task.status !== "running") throw new FlowError("This task has finished. Start a new one to keep going.");

  // "Now" only interrupts while Forge is working; during checks or review it waits for Forge's next step.
  const step = forgeSteps.get(taskId);
  const interrupts = delivery === "now" && step !== undefined && !step.signal.aborted;
  emit(taskId, { type: "message", actor: "you", text, delivery: interrupts ? "now" : "later" });
  inbox.set(taskId, [...(inbox.get(taskId) ?? []), text]);
  if (interrupts) {
    emit(taskId, { type: "steer", actor: "system" });
    step.abort();
  }
}

export function ackAssumptions(taskId: string): Task {
  if (!tasks.get(taskId)) throw new FlowError("Task not found.");
  return tasks.update(taskId, { assumptionsAck: true });
}

export function sendBack(taskId: string, notes: string): void {
  const task = tasks.get(taskId);
  if (!task || task.status !== "review") throw new FlowError("Only tasks waiting for review can be sent back.");

  const round = task.round + 1;
  emit(taskId, { type: "text", actor: "you", text: notes });
  tasks.update(taskId, { round, maxRounds: Math.max(task.maxRounds, round) });
  emit(taskId, { type: "round", actor: "system", round });
  node(taskId, "you", "done");
  setStatus(taskId, "running");
  drive(taskId, (signal) => loop(taskId, { kind: "notes", notes }, signal));
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
