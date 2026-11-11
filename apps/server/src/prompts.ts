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
  return `\nHouse rules for this repository (always follow them):\n${active.map((r) => `- ${r.text}`).join("\n")}\n`;
}

function header(agent: Agent, role: string, task: Task, rules: HouseRule[]): string {
  return [
    `You are ${agent.name}, the ${role} in a small crew of AI agents working on a git repository.`,
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
  const lines = ["", "How to finish:", "- Work only inside the current directory. Do not commit, create branches or push: the user reviews and merges."];
  if (style.askMode === "decide") {
    lines.push(
      "- Don't stop to ask. When a product decision isn't clear from the code, pick the option that best fits the existing conventions and keep going.",
      `- Only if a wrong guess would be destructive or very expensive to undo (data loss, a public API, security), stop and end your final message with exactly one line:\n  ${QUESTION_MARKER} {"question": "...", "context": "one sentence on why it matters", "options": ["short option", "short option"], "suggested": 0}`,
    );
  } else {
    lines.push(
      `- If you truly need a product decision you cannot infer from the code, stop and end your final message with exactly one line:\n  ${QUESTION_MARKER} {"question": "...", "context": "one sentence on why it matters", "options": ["short option", "short option"], "suggested": 0}\n  Only ask when guessing wrong would waste real work.`,
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

const FILE_TOOLS_NOTE =
  "Create and change files with your file-editing tools, not with shell redirection or in-place edits (cat >, echo >, tee, sed -i): those commands can be refused, which wastes a step.";

export function forgeStartPrompt(agent: Agent, task: Task, rules: HouseRule[], commands: ForgeCommands = "standard", style: ForgeStyle = DEFAULT_STYLE): string {
  return `${header(agent, "builder", task, rules)}
${FILE_TOOLS_NOTE}
${commands === "restricted" ? RESTRICTED_NOTE : ""}
Your task:
${task.prompt}
${forgeEnding(style, false)}`;
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
): string {
  const diff =
    diffText.length > MAX_DIFF_CHARS ? `${diffText.slice(0, MAX_DIFF_CHARS)}\n… (diff truncated, read files for the rest)` : diffText;
  const checkLines = checks.length
    ? checks.map((c) => `- ${c.name} (\`${c.command}\`): ${c.ok ? "passed" : "FAILED"}`).join("\n")
    : "- No checks are configured for this repository.";

  return `${header(agent, "reviewer", task, rules)}

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
): string {
  const roster = team
    .map(
      (m) =>
        `- id "${m.id}" · ${m.name} · ${m.role === "builder" ? "builds: edits files and runs commands" : "reviews: reads the change, approves it or sends it back"}${m.instructions ? `. Instructions: ${m.instructions}` : ""}`,
    )
    .join("\n");
  const pt = task.locale === "pt-BR";
  return `${header(agent, "lead", task, rules)}

You plan which teammates work on this task. You never edit files or run commands; read files only if you need to understand the task.

Task:
${task.prompt}

Your team:
${roster}

Checks this repository runs: ${checks.length ? checks.join(", ") : "none configured"}.
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
  const { summary, steps: rawSteps } = data as { summary?: unknown; steps: unknown[] };
  const used = new Set<string>();
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
      const target = typeof o.sendBackTo === "string" ? [...steps].reverse().find((s) => s.type === "agent" && s.agentId === o.sendBackTo) : undefined;
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
