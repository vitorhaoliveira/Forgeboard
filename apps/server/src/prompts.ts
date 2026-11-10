import { normalizeForm } from "@forgeboard/shared/a2ui";
import type {
  Agent,
  AgentForm,
  AgentQuestion,
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

const FORGE_ENDING = `
How to finish:
- Work only inside the current directory. Do not commit, create branches or push: the user reviews and merges.
- If you truly need a product decision you cannot infer from the code, stop and end your final message with exactly one line:
  ${QUESTION_MARKER} {"question": "...", "context": "one sentence on why it matters", "options": ["short option", "short option"], "suggested": 0}
  Only ask when guessing wrong would waste real work.
- When you need several decisions at once, or the task touches several files or layers and the user should approve a plan first, ask with a form instead, as exactly one line at the very end:
  ${FORM_MARKER} {"kind": "questions" | "plan", "title": "...", "context": "one or two sentences", "fields": [...]}
  Field types (at most 6 fields):
  {"id": "lib", "type": "choice", "label": "...", "options": ["...", "..."], "suggested": 0}
  {"id": "metrics", "type": "multi", "label": "...", "options": ["...", "..."], "value": ["..."]}
  {"id": "dark", "type": "toggle", "label": "...", "value": true}
  {"id": "name", "type": "text", "label": "...", "value": "default", "mono": true}
  {"id": "plan", "type": "steps", "label": "...", "value": [{"text": "step", "estimate": "~2 min"}]}
  A plan form has one "steps" field and must come before you change any file. Never ask for a plan on small tasks.
- Otherwise end with a short summary (2-4 sentences) of what you changed and why.`;

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

export function forgeStartPrompt(agent: Agent, task: Task, rules: HouseRule[]): string {
  return `${header(agent, "builder", task, rules)}

Your task:
${task.prompt}
${FORGE_ENDING}`;
}

export function forgeAnswerPrompt(answer: string, form?: AgentForm, data?: FormAnswer, extra: { note?: string; replan?: boolean } = {}): string {
  const note = extra.note ? `\n\nNote from the user: ${extra.note}` : "";
  if (form && extra.replan) {
    return `The user did not approve your plan and wants a different one.${note}\n\nDo not change files yet. Look again and propose a new plan with ${FORM_MARKER}.\n${FORGE_ENDING}`;
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
    return `${parts.filter(Boolean).join("\n\n")}${note}\n${FORGE_ENDING}`;
  }
  return `The user answered your question: "${answer}". Continue the task with that decision.
${FORGE_ENDING}`;
}

export function forgeFixPrompt(task: Task): string {
  const verdict = task.verdict;
  return `The reviewer looked at your work (round ${task.round - 1}) and asked for changes.
${verdict?.summary ? `\nReviewer summary: ${verdict.summary}\n` : ""}${verdict?.issues.length ? `\nIssues:\n${formatIssues(verdict.issues)}\n` : ""}${formatFailedChecks(task.checks)}
Fix these, without unrelated changes.
${FORGE_ENDING}`;
}

export function forgeNotesPrompt(notes: string): string {
  return `The user reviewed your work and sent it back with these notes:
${notes}

Address them, without unrelated changes.
${FORGE_ENDING}`;
}

export function hawkPrompt(agent: Agent, task: Task, rules: HouseRule[], diffText: string, checks: CheckResult[]): string {
  const diff =
    diffText.length > MAX_DIFF_CHARS ? `${diffText.slice(0, MAX_DIFF_CHARS)}\n… (diff truncated, read files for the rest)` : diffText;
  const checkLines = checks.length
    ? checks.map((c) => `- ${c.name} (\`${c.command}\`): ${c.ok ? "passed" : "FAILED"}`).join("\n")
    : "- No checks are configured for this repository.";

  return `${header(agent, "reviewer", task, rules)}

You review, you never modify files. Review the change made for this task:
${task.prompt}

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

End your answer with one fenced json block and nothing after it:
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

/** Removes the question or form marker line so the message reads naturally. */
export function stripQuestion(text: string): string {
  const idx = Math.max(text.lastIndexOf(QUESTION_MARKER), text.lastIndexOf(FORM_MARKER));
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
