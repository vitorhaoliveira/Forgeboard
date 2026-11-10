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
  forgeNotesPrompt,
  forgeStartPrompt,
  hawkPrompt,
  parseForm,
  parseQuestion,
  parseVerdict,
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
  | { kind: "fix" } | { kind: "notes"; notes: string };

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

  const prompt =
    mode.kind === "start"
      ? forgeStartPrompt(agent, task, repoRules, commands)
      : mode.kind === "answer"
        ? forgeAnswerPrompt(mode.answer, mode.form, mode.data, mode)
        : mode.kind === "fix"
          ? forgeFixPrompt(task)
          : forgeNotesPrompt(mode.notes);

  node(taskId, "forge", "active");
  const output = await getProvider(agent.provider).run({
    role: "forge",
    prompt,
    cwd: worktree,
    permissionMode: "acceptEdits",
    allowedTools: FORGE_ALLOWED_TOOLS[commands],
    // Keep the same conversation across rounds so Forge remembers its work.
    resumeSession: mode.kind === "start" ? undefined : state.forgeSession,
    locale: task.locale,
    round: task.round,
    signal,
    emit: activityEmitter(taskId, "forge"),
  });
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

  emit(taskId, { type: "step_done", actor: "forge", summary: output.text, costUsd: output.costUsd, durationMs: output.durationMs });
  tasks.update(taskId, { summary: output.text });
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
      prompt: hawkPrompt(agent, task, rules.forRepo(repos.get(task.repoId)!), diffText, checks),
      cwd: worktree,
      permissionMode: "plan",
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
  const data = form && !replan ? sanitizeAnswer(form, rawData) : undefined;

  emit(taskId, { type: "answer", actor: "you", text: answer, remember, ...(data ? { data } : {}), ...(extra.note ? { note: extra.note } : {}), ...(replan ? { replan } : {}) });
  if (remember && !replan) {
    // A form becomes one rule per decision; plans are specific to this task, so they're never remembered.
    const texts = form
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
  drive(taskId, (signal) => loop(taskId, { kind: "answer", answer, form, data, note: extra.note, replan }, signal));
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
