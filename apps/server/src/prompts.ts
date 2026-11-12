import { normalizeForm } from "@forgeboard/shared/a2ui";
import type {
  Agent,
  AgentForm,
  AskMode,
  AgentQuestion,
  ForgeCommands,
  FlowStep,
  FormAnswer,
  PlanStep,
  CheckResult,
  HouseRule,
  Locale,
  Personality,
  ReviewIssue,
  Task,
  Verdict,
  WorkKind,
} from "@forgeboard/shared";

const MAX_DIFF_CHARS = 60_000;
const QUESTION_MARKER = "FORGEBOARD_QUESTION:";
const FORM_MARKER = "FORGEBOARD_FORM:";

function language(locale: Locale): string {
  return locale === "pt-BR"
    ? "Write every message meant for the user in Brazilian Portuguese. Keep code, identifiers and commit-style text in English unless a house rule says otherwise."
    : "Write every message meant for the user in US English.";
}

const PERSONALITY: Record<Personality, string> = {
  mentor: "Tone: patient mentor. Explain the reasoning behind your choices briefly.",
  balanced: "Tone: friendly and direct.",
  strict: "Tone: strict and concise. No pleasantries.",
};

function houseRules(rules: HouseRule[]): string {
  const active = rules.filter((r) => r.enabled);
  if (active.length === 0) return "";
  return `\nHouse rules (always follow them):\n${active.map((r) => `- ${r.text}`).join("\n")}\n`;
}

/** What the team works on: code (the default) or other work in a folder of files. */
export interface WorkContext {
  kind: WorkKind;
  /** The team's own words about its work. */
  about: string;
}

export const CODE_WORK: WorkContext = { kind: "code", about: "" };

function where(work: WorkContext): string {
  if (work.kind === "code") {
    return `working on a git repository.${work.about ? `\nWhat this team works on: ${work.about}` : ""}`;
  }
  return [
    `working in a folder of files${work.about ? ` for this team: ${work.about}` : "."}`,
    "The folder is tracked with git only so the user can review your changes; you don't need git.",
  ].join("\n");
}

function header(agent: Agent, role: string, task: Task, rules: HouseRule[], work: WorkContext = CODE_WORK): string {
  return [
    `You are ${agent.name}, the ${role} in a small crew of AI agents ${where(work)}`,
    language(task.locale),
    PERSONALITY[agent.personality],
    agent.instructions ? `Extra instructions from the user: ${agent.instructions}` : "",
    houseRules(rules),
  ]
    .filter(Boolean)
    .join("\n");
}

const ASSUMPTIONS_MARKER = "FORGEBOARD_ASSUMPTIONS:";

/** How Forge handles unclear decisions in this workspace. */
export interface ForgeStyle {
  askMode: AskMode;
  planFirst: boolean;
  work?: WorkContext;
}

export const DEFAULT_STYLE: ForgeStyle = { askMode: "ask", planFirst: true };

const FORM_FIELDS = `  Field types (at most 6 fields):
  {"id": "lib", "type": "choice", "label": "...", "options": ["...", "..."], "suggested": 0}
  {"id": "metrics", "type": "multi", "label": "...", "options": ["...", "..."], "value": ["..."]}
  {"id": "dark", "type": "toggle", "label": "...", "value": true}
  {"id": "name", "type": "text", "label": "...", "value": "default", "mono": true}
  {"id": "plan", "type": "steps", "label": "...", "value": [{"text": "step", "estimate": "~2 min"}]}`;

/**
 * The end of every Forge prompt. `followUp` is true for every step after the first one
 * (answers, fixes, notes, messages), so a new list of decisions replaces the previous one.
 */
function forgeEnding(style: ForgeStyle, followUp = true): string {
  const source = (style.work ?? CODE_WORK).kind === "code" ? "the code" : "the files and the task";
  const code = (style.work ?? CODE_WORK).kind === "code";
  const lines = [
    "",
    "How to finish:",
    code
      ? "- Work only inside the current directory. Do not commit, create branches or push: the user reviews and merges."
      : "- Work only inside the current directory. Do not use git: the user reviews your changes and accepts them.",
  ];
  if (style.askMode === "decide") {
    lines.push(
      `- Don't stop to ask. When a decision isn't clear from ${source}, pick the option that best fits the existing conventions and keep going.`,
      `- Only if a wrong guess would be destructive or very expensive to undo (data loss, a public API, security), stop and end your final message with exactly one line:\n  ${QUESTION_MARKER} {"question": "...", "context": "one sentence on why it matters", "options": ["short option", "short option"], "suggested": 0}`,
    );
  } else {
    lines.push(
      `- If you truly need a decision you cannot infer from ${source}, stop and end your final message with exactly one line:\n  ${QUESTION_MARKER} {"question": "...", "context": "one sentence on why it matters", "options": ["short option", "short option"], "suggested": 0}\n  Only ask when guessing wrong would waste real work.`,
      `- When you need several decisions at once, ask with a form instead, as exactly one line at the very end:\n  ${FORM_MARKER} {"kind": "questions", "title": "...", "context": "one or two sentences", "fields": [...]}`,
    );
  }
  if (style.planFirst) {
    lines.push(
      `- If the task touches several files or layers, propose a plan before changing any file, as exactly one line at the very end:\n  ${FORM_MARKER} {"kind": "plan", "title": "...", "context": "one or two sentences", "fields": [{"id": "plan", "type": "steps", "label": "Plan", "value": [{"text": "step", "estimate": "~2 min"}]}]}\n  Never propose a plan for small tasks, and only once per task.`,
    );
  }
  if (style.askMode === "ask" || style.planFirst) lines.push(FORM_FIELDS);
  lines.push("- Otherwise end with a short summary (2-4 sentences) of what you changed and why.");
  if (style.askMode === "decide") {
    lines.push(`- If you made decisions the user didn't specify, add one last line listing them, each with a short reason:\n  ${ASSUMPTIONS_MARKER} ["Used 25 rows per page, like OrdersTable", "..."]`);
    if (followUp) {
      lines.push(
        "  This list replaces your previous one. If you listed decisions earlier in this task, always send the updated list, even when nothing changed: keep the earlier decisions that still hold, leave out any the user's messages or your latest changes made obsolete, and send [] if none still hold.",
      );
    }
  }
  return lines.join("\n");
}

/** Messages the user sent while Forge worked, put before the next instructions. */
export function messagesNote(messages: string[]): string {
  if (messages.length === 0) return "";
  const list = messages.map((m) => `- ${m}`).join("\n");
  return `The user sent you ${messages.length === 1 ? "a message" : "messages"} while you worked. Take ${messages.length === 1 ? "it" : "them"} into account now, before anything else:\n${list}\n\n`;
}

export function forgeMessagesPrompt(messages: string[], style: ForgeStyle): string {
  return `${messagesNote(messages)}Continue the task with this in mind. If you already changed something it affects, adjust it.\n${forgeEnding(style)}`;
}

function formatIssues(issues: ReviewIssue[]): string {
  return issues
    .map((i) => `- [${i.severity.toUpperCase()}] ${i.file ? `${i.file}${i.line ? `:${i.line}` : ""} ` : ""}${i.message}`)
    .join("\n");
}

function formatFailedChecks(checks: CheckResult[] | null): string {
  const failed = (checks ?? []).filter((c) => !c.ok);
  if (failed.length === 0) return "";
  return `\nFailing checks:\n${failed.map((c) => `### ${c.name} (\`${c.command}\`)\n${c.output.slice(-2_000)}`).join("\n\n")}\n`;
}

const RESTRICTED_NOTE = `
Commands: in this workspace you can only edit files and use read-only git and ls. Don't try to install packages or run tests; Forgeboard runs the repository's checks after you finish and sends you any failures.
`;

const FILES_ONLY_NOTE = `
Commands: you only edit files here (read-only git and ls are fine). There is nothing to install or run.
`;

const FILE_TOOLS_NOTE =
  "Create and change files with your file-editing tools, not with shell redirection or in-place edits (cat >, echo >, tee, sed -i): those commands can be refused, which wastes a step.";

export function forgeStartPrompt(
  agent: Agent,
  task: Task,
  rules: HouseRule[],
  commands: ForgeCommands = "standard",
  style: ForgeStyle = DEFAULT_STYLE,
  brief?: string,
): string {
  const work = style.work ?? CODE_WORK;
  const note = commands !== "restricted" ? "" : work.kind === "code" ? RESTRICTED_NOTE : FILES_ONLY_NOTE;
  return `${header(agent, "builder", task, rules, work)}
${FILE_TOOLS_NOTE}
${note}
Your task:
${task.prompt}
${brief ? `\nOthers on the team already worked on this task, in this same folder. Note from the lead, who brought you in:\n${brief}\n` : ""}${forgeEnding(style, false)}`;
}

export function forgeAnswerPrompt(
  answer: string,
  form?: AgentForm,
  data?: FormAnswer,
  extra: { note?: string; replan?: boolean } = {},
  style: ForgeStyle = DEFAULT_STYLE,
): string {
  const note = extra.note ? `\n\nNote from the user: ${extra.note}` : "";
  if (form && extra.replan) {
    return `The user did not approve your plan and wants a different one.${note}\n\nDo not change files yet. Look again and propose a new plan with ${FORM_MARKER}.\n${forgeEnding(style)}`;
  }
  if (form && data) {
    const plan = form.fields.find((f) => f.type === "steps");
    const steps = plan ? ((data[plan.id] as PlanStep[] | undefined) ?? []).filter((s) => s.included !== false) : [];
    const rest = Object.fromEntries(Object.entries(data).filter(([k]) => k !== plan?.id));
    const parts = [
      form.kind === "plan" ? "The user approved your plan." : "The user filled in your form.",
      steps.length ? `Follow exactly these steps, in this order (the user may have edited, reordered or removed some):\n${steps.map((s, i) => `${i + 1}. ${s.text}`).join("\n")}` : "",
      Object.keys(rest).length ? `Answers:\n\`\`\`json\n${JSON.stringify(rest, null, 2)}\n\`\`\`` : "",
      "Continue the task with these decisions. Do not ask for the same plan again.",
    ];
    return `${parts.filter(Boolean).join("\n\n")}${note}\n${forgeEnding(style)}`;
  }
  return `The user answered your question: "${answer}". Continue the task with that decision.
${forgeEnding(style)}`;
}

export function forgeFixPrompt(task: Task, style: ForgeStyle = DEFAULT_STYLE): string {
  const verdict = task.verdict;
  return `The reviewer looked at your work (round ${task.round - 1}) and asked for changes.
${verdict?.summary ? `\nReviewer summary: ${verdict.summary}\n` : ""}${verdict?.issues.length ? `\nIssues:\n${formatIssues(verdict.issues)}\n` : ""}${formatFailedChecks(task.checks)}
Fix these, without unrelated changes.
${forgeEnding(style)}`;
}

export function forgeNotesPrompt(notes: string, style: ForgeStyle = DEFAULT_STYLE): string {
  return `The user reviewed your work and sent it back with these notes:
${notes}

Address them, without unrelated changes.
${forgeEnding(style)}`;
}

/** The verdict JSON is shown to the user as is, so it needs the language too (it came back in English). */
function verdictLanguage(locale: Locale): string {
  return locale === "pt-BR"
    ? 'Write "summary", every issue "message" and "suggestedRule" in Brazilian Portuguese; keep the keys and the "risk"/"severity" values in English.'
    : 'Write "summary", every issue "message" and "suggestedRule" in US English.';
}

export function hawkPrompt(
  agent: Agent,
  task: Task,
  rules: HouseRule[],
  diffText: string,
  checks: CheckResult[],
  yourWords: string[] = [],
  work: WorkContext = CODE_WORK,
): string {
  const diff =
    diffText.length > MAX_DIFF_CHARS ? `${diffText.slice(0, MAX_DIFF_CHARS)}\n… (diff truncated, read files for the rest)` : diffText;
  const checkLines = checks.length
    ? checks.map((c) => `- ${c.name} (\`${c.command}\`): ${c.ok ? "passed" : "FAILED"}`).join("\n")
    : work.kind === "code"
      ? "- No checks are configured for this repository."
      : "- No checks run for this folder.";

  return `${header(agent, "reviewer", task, rules, work)}

You review, you never modify files. Review the change made for this task:
${task.prompt}
${
  yourWords.length
    ? `\nWhat the user told the crew after that, in order. These are part of the request: don't flag them as out of scope.\n${yourWords.map((w) => `- ${w}`).join("\n")}\n`
    : ""
}
What the builder says it did:
${task.summary ?? "(no summary)"}

Check results:
${checkLines}
${formatFailedChecks(checks)}
Diff against the starting point:
\`\`\`diff
${diff}
\`\`\`

You may read files for context. Approve only if every check passed and there is no high-severity issue. Also check the house rules.

End your answer with one fenced json block and nothing after it. ${verdictLanguage(task.locale)}
\`\`\`json
{
  "approved": true,
  "risk": "low | medium | high",
  "summary": "1-2 sentences for the user: what changed and whether it is safe",
  "issues": [{ "severity": "high | medium | low", "message": "...", "file": "path", "line": 12 }],
  "suggestedRule": "optional: a general convention this change shows the crew should always follow; omit if none"
}
\`\`\``;
}

/** Pulls an agent question out of Forge's final message, if there is one. */
export function parseQuestion(text: string): AgentQuestion | null {
  const idx = text.lastIndexOf(QUESTION_MARKER);
  if (idx === -1) return null;
  const raw = text.slice(idx + QUESTION_MARKER.length).trim();
  const json = raw.slice(0, raw.lastIndexOf("}") + 1);
  try {
    const q = JSON.parse(json) as Partial<AgentQuestion>;
    if (typeof q.question !== "string" || !q.question.trim()) return null;
    const options = Array.isArray(q.options) ? q.options.filter((o): o is string => typeof o === "string").slice(0, 4) : [];
    return {
      question: q.question,
      context: typeof q.context === "string" ? q.context : undefined,
      options,
      suggested: typeof q.suggested === "number" && q.suggested < options.length ? q.suggested : undefined,
    };
  } catch {
    return null;
  }
}

/** Pulls a form out of Forge's final message, if there is one. */
export function parseForm(text: string): AgentForm | null {
  const idx = text.lastIndexOf(FORM_MARKER);
  if (idx === -1) return null;
  const raw = text.slice(idx + FORM_MARKER.length).trim();
  try {
    return normalizeForm(JSON.parse(raw.slice(0, raw.lastIndexOf("}") + 1)));
  } catch {
    return null;
  }
}

/** Pulls the list of decisions Forge made on its own ("decide" mode). */
/** Forge's list of decisions, or null when it sent none. An empty list means none still hold. */
export function parseAssumptions(text: string): string[] | null {
  const idx = text.lastIndexOf(ASSUMPTIONS_MARKER);
  if (idx === -1) return null;
  const raw = text.slice(idx + ASSUMPTIONS_MARKER.length).trim();
  try {
    const list = JSON.parse(raw.slice(0, raw.lastIndexOf("]") + 1)) as unknown;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim().slice(0, 240)).slice(0, 8) : null;
  } catch {
    return null;
  }
}

/** Removes the question, form or assumptions marker line so the message reads naturally. */
export function stripQuestion(text: string): string {
  const idx = Math.max(text.lastIndexOf(QUESTION_MARKER), text.lastIndexOf(FORM_MARKER), text.lastIndexOf(ASSUMPTIONS_MARKER));
  return (idx === -1 ? text : text.slice(0, idx)).trim();
}

/** Reads Hawk's verdict from the last json block of its message. */
export function parseVerdict(text: string): Verdict | null {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  const candidates = blocks.length ? [blocks.at(-1)![1]!] : [text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
  for (const candidate of candidates) {
    try {
      const v = JSON.parse(candidate) as Partial<Verdict>;
      if (typeof v.approved !== "boolean") continue;
      const issues = Array.isArray(v.issues)
        ? v.issues
            .filter((i) => i && typeof i.message === "string")
            .map((i) => ({
              severity: (["high", "medium", "low"].includes(i.severity) ? i.severity : "medium") as ReviewIssue["severity"],
              message: i.message,
              file: typeof i.file === "string" ? i.file : undefined,
              line: typeof i.line === "number" ? i.line : undefined,
            }))
        : [];
      return {
        approved: v.approved,
        risk: v.risk === "low" || v.risk === "high" ? v.risk : "medium",
        summary: typeof v.summary === "string" ? v.summary : "",
        issues,
        suggestedRule: typeof v.suggestedRule === "string" && v.suggestedRule.trim() ? v.suggestedRule.trim() : undefined,
      };
    } catch {
      // try the next candidate
    }
  }
  return null;
}

// ---------- Lead ----------

const PLAN_MARKER = "FORGEBOARD_PLAN:";

/** How the lead sees a teammate. */
export interface Teammate {
  id: string;
  name: string;
  role: "builder" | "reviewer";
  instructions: string;
}

/**
 * What the lead is told: the task, the team and the checks, and how to answer with a plan.
 * With `note`, you asked for another plan after seeing `previous`.
 */
export function leadPrompt(
  agent: Agent,
  task: Task,
  rules: HouseRule[],
  team: Teammate[],
  checks: string[],
  replan?: { note: string; previous: string },
  work: WorkContext = CODE_WORK,
  canRun = true,
): string {
  const roster = rosterText(team, canRun);
  const pt = task.locale === "pt-BR";
  return `${header(agent, "lead", task, rules, work)}

You plan which teammates work on this task. You never edit files or run commands; read files only if you need to understand the task.

Task:
${task.prompt}

Your team:
${roster}

Checks ${work.kind === "code" ? "this repository" : "this folder"} runs: ${checks.length ? checks.join(", ") : "none configured"}.
${
  replan
    ? `\nYou proposed this plan:\n${replan.previous}\n\nThe user asked for another one: ${replan.note}\nPlan again with that in mind.\n`
    : ""
}
Pick the smallest team that does this task well:
- Start with an agent that builds.
- Add {"type": "checks"} when the repository has checks and the change can break them.
- Add a reviewer when a second look is worth it (risky, public or large changes). A reviewer sends work back to the builder right before it; when its review is about another builder's work, set "sendBackTo" to that builder's id. Set "maxRounds" (1-5) only when the default of 3 doesn't fit.
- Add {"type": "ask", "note": "what to check"} only when the user should look before the next step.
- Use only the ids above, at most 8 steps. The same agent may appear more than once.

End your answer with exactly one line and nothing after it:
${PLAN_MARKER} {"summary": "1-2 sentences for the user", "steps": [{"type": "agent", "agentId": "...", "why": "one line"}, {"type": "checks", "why": "..."}, {"type": "agent", "agentId": "...", "sendBackTo": "...", "why": "..."}]}
Write "summary" and every "why" in ${pt ? "Brazilian Portuguese" : "US English"}.`;
}

function rosterText(team: Teammate[], canRun: boolean): string {
  return team
    .map(
      (m) =>
        `- id "${m.id}" · ${m.name} · ${m.role === "builder" ? (canRun ? "builds: edits files and runs commands" : "makes: edits files") : "reviews: reads the change, approves it or sends it back"}${m.instructions ? `. Instructions: ${m.instructions}` : ""}`,
    )
    .join("\n");
}

const DECISION_MARKER = "FORGEBOARD_DECISION:";
const ANSWER_MARKER = "FORGEBOARD_ANSWER:";

/** What happened so far, for the Lead at a checkpoint. */
export interface CheckpointContext {
  kind: "stuck" | "note";
  /** The steps that already ran, as lines ("- Forge: why"). */
  done: string;
  /** The steps still planned after this point, as lines (empty when none). */
  ahead: string;
  /** "stuck": the reviewer's name, its summary and open issues, and failing checks. */
  review?: { reviewer: string; summary: string; issues: ReviewIssue[]; failedChecks: string[] };
  /** "note": what you wrote at the pause. */
  note?: string;
  rounds: number;
}

/**
 * The Lead decides what happens next mid-task: when a reviewer still asks for changes after
 * its last round, or when you send it a note at a pause.
 */
export function leadCheckpointPrompt(
  agent: Agent,
  task: Task,
  rules: HouseRule[],
  team: Teammate[],
  checks: string[],
  ctx: CheckpointContext,
  work: WorkContext = CODE_WORK,
  canRun = true,
): string {
  const pt = task.locale === "pt-BR";
  const situation =
    ctx.kind === "stuck"
      ? `${ctx.review!.reviewer} still asks for changes after ${ctx.rounds} round(s), the last one allowed.
Reviewer summary: ${ctx.review!.summary || "(none)"}
${ctx.review!.issues.length ? `Open issues:\n${formatIssues(ctx.review!.issues)}\n` : ""}${ctx.review!.failedChecks.length ? `Failing checks: ${ctx.review!.failedChecks.join(", ")}\n` : ""}
Decide what happens now:
- "retry": one more round for the builder, when the issues look fixable with one more try;
- "replan": new steps to run next (for example another builder who knows this area, or a different reviewer), when the current builder is the wrong fit;
- "you": hand it to the user as it is, when it needs a human decision or more rounds won't help.`
      : `The user paused the task and wrote: "${ctx.note}"
Decide what happens now:
- "replan": new steps to run next that do what the user asked (often a builder, maybe followed by a reviewer);
- "continue": run the steps still planned, when the note needs no extra work.`;
  const actions = ctx.kind === "stuck" ? '"retry" | "replan" | "you"' : '"replan" | "continue"';
  return `${header(agent, "lead", task, rules, work)}

You lead this task and planned who works on it. Now you are asked to decide the next step. You never edit files or run commands; read files only if you need to.

Task:
${task.prompt}

Your team:
${rosterText(team, canRun)}

Checks ${work.kind === "code" ? "this repository" : "this folder"} runs: ${checks.length ? checks.join(", ") : "none configured"}.

Steps that ran:
${ctx.done || "- (none)"}
${ctx.ahead ? `\nSteps still planned:\n${ctx.ahead}\n` : ""}
${situation}

With "replan", list only the new steps, in the same format as a plan: builders, {"type": "checks"}, reviewers (with "sendBackTo" a builder's id), at most 5 steps, only the ids above. They replace the steps still planned.

End your answer with exactly one line and nothing after it:
${DECISION_MARKER} {"action": ${actions}, "why": "one sentence for the user", "steps": [{"type": "agent", "agentId": "...", "why": "..."}]}
Leave "steps" out unless the action is "replan". Write "why" in ${pt ? "Brazilian Portuguese" : "US English"}.`;
}

export interface ParsedDecision {
  action: "retry" | "replan" | "you" | "continue";
  why: string;
  /** Raw steps, for parsePlan. */
  plan: ParsedPlan | null;
}

/** Reads the Lead's decision line, or null when there is none or the action isn't allowed. */
export function parseDecision(text: string, allowed: ParsedDecision["action"][], existing: FlowStep[] = []): ParsedDecision | null {
  const idx = text.lastIndexOf(DECISION_MARKER);
  if (idx === -1) return null;
  const raw = text.slice(idx + DECISION_MARKER.length).trim();
  let data: { action?: unknown; why?: unknown; steps?: unknown };
  try {
    data = JSON.parse(raw.slice(0, raw.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
  const action = data.action as ParsedDecision["action"];
  if (!allowed.includes(action)) return null;
  const why = typeof data.why === "string" ? data.why.trim().slice(0, 300) : "";
  const plan = action === "replan" && Array.isArray(data.steps) ? parsePlanData({ steps: data.steps.slice(0, 5) }, existing) : null;
  return { action, why, plan };
}

/**
 * The Lead reads a builder's question and answers it from the task, the house rules and what the
 * user said, or says it isn't sure.
 */
export function leadAnswerPrompt(
  agent: Agent,
  task: Task,
  rules: HouseRule[],
  asker: string,
  question: AgentQuestion,
  yourWords: string[],
  work: WorkContext = CODE_WORK,
): string {
  const pt = task.locale === "pt-BR";
  return `${header(agent, "lead", task, rules, work)}

You lead this task. ${asker}, a builder on your team, stopped to ask a question. Answer it if the task, the house rules or what the user said make the answer clear; read files if that helps. Otherwise say you aren't sure: the user will decide.

Task:
${task.prompt}
${yourWords.length ? `\nWhat the user said after that, in order:\n${yourWords.map((w) => `- ${w}`).join("\n")}\n` : ""}
${asker}'s question: ${question.question}
${question.context ? `Why it matters: ${question.context}\n` : ""}${question.options.length ? `Options: ${question.options.map((o) => `"${o}"`).join(", ")}\n` : ""}
Be sure only when a wrong answer would not waste real work or surprise the user. Prefer one of the options, word for word.

End your answer with exactly one line and nothing after it:
${ANSWER_MARKER} {"answer": "...", "sure": true, "why": "one sentence for the user"}
Write "answer" and "why" in ${pt ? "Brazilian Portuguese" : "US English"}.`;
}

export interface ParsedLeadAnswer {
  answer: string;
  sure: boolean;
  why: string;
}

export function parseLeadAnswer(text: string): ParsedLeadAnswer | null {
  const idx = text.lastIndexOf(ANSWER_MARKER);
  if (idx === -1) return null;
  const raw = text.slice(idx + ANSWER_MARKER.length).trim();
  try {
    const d = JSON.parse(raw.slice(0, raw.lastIndexOf("}") + 1)) as { answer?: unknown; sure?: unknown; why?: unknown };
    if (typeof d.answer !== "string" || !d.answer.trim()) return null;
    return { answer: d.answer.trim().slice(0, 500), sure: d.sure === true, why: typeof d.why === "string" ? d.why.trim().slice(0, 300) : "" };
  } catch {
    return null;
  }
}

/** The Lead's message without its decision or answer line. */
export function stripLeadLine(text: string): string {
  const idx = Math.max(text.lastIndexOf(DECISION_MARKER), text.lastIndexOf(ANSWER_MARKER));
  return (idx === -1 ? text : text.slice(0, idx)).trim();
}

export interface ParsedPlan {
  summary: string;
  steps: FlowStep[];
  reasons: Record<string, string>;
}

/** Reads the lead's plan into flow steps with ids, or null when there is no usable plan line. */
export function parsePlan(text: string): ParsedPlan | null {
  const idx = text.lastIndexOf(PLAN_MARKER);
  if (idx === -1) return null;
  const raw = text.slice(idx + PLAN_MARKER.length).trim();
  let data: unknown;
  try {
    data = JSON.parse(raw.slice(0, raw.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || !Array.isArray((data as { steps?: unknown }).steps)) return null;
  return parsePlanData(data as { summary?: unknown; steps: unknown[] });
}

/**
 * Turns plan steps into flow steps with ids. `existing` are steps already in the flow: new ids
 * don't clash with them, and "sendBackTo" can name a builder among them.
 */
function parsePlanData(data: { summary?: unknown; steps: unknown[] }, existing: FlowStep[] = []): ParsedPlan {
  const { summary, steps: rawSteps } = data;
  const used = new Set<string>(existing.map((s) => s.id));
  const idFor = (base: string) => {
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  };
  const steps: FlowStep[] = [];
  const reasons: Record<string, string> = {};
  for (const s of rawSteps.slice(0, 8)) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const why = typeof o.why === "string" ? o.why.trim().slice(0, 200) : "";
    let step: FlowStep | null = null;
    if (o.type === "agent" && typeof o.agentId === "string") {
      const maxRounds = typeof o.maxRounds === "number" && Number.isInteger(o.maxRounds) ? Math.min(5, Math.max(1, o.maxRounds)) : undefined;
      // "sendBackTo" names an agent: the last step of that agent so far.
      const target = typeof o.sendBackTo === "string" ? [...existing, ...steps].reverse().find((s) => s.type === "agent" && s.agentId === o.sendBackTo) : undefined;
      step = { id: idFor(o.agentId), type: "agent", agentId: o.agentId, ...(maxRounds ? { maxRounds } : {}), ...(target ? { sendBackTo: target.id } : {}) };
    } else if (o.type === "checks") {
      step = { id: idFor("checks"), type: "checks" };
    } else if (o.type === "ask") {
      step = { id: idFor("ask"), type: "ask", ...(typeof o.note === "string" && o.note.trim() ? { note: o.note.trim().slice(0, 300) } : {}) };
    }
    if (!step) continue;
    steps.push(step);
    if (why) reasons[step.id] = why;
  }
  return { summary: typeof summary === "string" ? summary.trim().slice(0, 400) : "", steps, reasons };
}

/** The lead's message without the plan line. */
export function stripPlan(text: string): string {
  const idx = text.lastIndexOf(PLAN_MARKER);
  return (idx === -1 ? text : text.slice(0, idx)).trim();
}
