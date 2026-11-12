/**
 * A simulated Forgeboard backend that runs entirely in the browser, for the public demo.
 * It seeds a few workspaces and tasks, and plays scripted runs with real timing:
 * runs pause on questions and continue when the visitor answers, merges, or sends work back.
 */
import type {
  Actor,
  Agent,
  AgentId,
  CheckCommand,
  CreateTaskInput,
  CreateWorkspaceInput,
  DiffFile,
  Flow,
  FlowStep,
  FolderListing,
  HouseRule,
  Locale,
  NodeState,
  ProviderInfo,
  Repo,
  RuleScope,
  RuleSource,
  RunEvent,
  RunEventPayload,
  Task,
  TaskStatus,
  Team,
  Verdict,
  Workspace,
} from "@forgeboard/shared";
import { BUILD_AND_REVIEW, draftMembers, isDocument, LEAD_DECIDES, LEAD_DECIDES_ID, normalizeTeamDraft, TEAM_TEMPLATES, templateMembers, type TeamProposal } from "@forgeboard/shared";
import type { Api, StreamHandlers } from "../api";
import { sanitizeAnswer } from "@forgeboard/shared/a2ui";
import {
  API_CHECKS,
  apiValidationScenario,
  BLOG_CHECKS,
  docPatch,
  faqDiff,
  guideDiff,
  paginationScenario,
  pixScenario,
  settingsScenario,
  SHOP_CHECKS,
  simpleDoneScenario,
  tr,
  WEB_CHECKS,
  type ScenarioContent,
  type ToolStep,
} from "./scenarios";

// ---------- State ----------

interface Store {
  locale: Locale;
  workspaces: Workspace[];
  repos: Repo[];
  tasks: Task[];
  events: Map<string, RunEvent[]>;
  diffs: Map<string, DiffFile[]>;
  scenarios: Map<string, ScenarioContent>;
  defaults: Agent[];
  overrides: Map<string, Agent[]>;
  rules: HouseRule[];
  /** Flows the visitor made (Build & Review is built in). */
  flows: Flow[];
  /** Teams the visitor made. */
  teams: Team[];
  /** Steps left to play once the visitor acts (after a question). */
  pending: Map<string, Step[]>;
  timers: Map<string, ReturnType<typeof setTimeout>[]>;
  listeners: Map<string, Set<StreamHandlers>>;
}

let store: Store | null = null;
/** Set while seeding, so seeded events get past timestamps. */
let clock: number | null = null;

const id = () => Math.random().toString(36).slice(2, 12);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const now = () => clock ?? Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

function s(): Store {
  if (!store) store = seed(typeof document !== "undefined" && document.documentElement.lang === "pt-BR" ? "pt-BR" : "en-US");
  return store;
}

function emit(taskId: string, payload: RunEventPayload): void {
  const st = s();
  const list = st.events.get(taskId) ?? [];
  const event = { ...payload, taskId, seq: list.length + 1, ts: iso(now()) } as RunEvent;
  list.push(event);
  st.events.set(taskId, list);
  if (clock === null) for (const l of st.listeners.get(taskId) ?? []) l.onEvent(clone(event));
}

function patchTask(taskId: string, patch: Partial<Task>): Task {
  const st = s();
  const i = st.tasks.findIndex((t) => t.id === taskId);
  const next = { ...st.tasks[i]!, ...patch, updatedAt: iso(now()) };
  st.tasks[i] = next;
  return next;
}

function finishedStatus(status: TaskStatus) {
  return status === "merged" || status === "discarded" || status === "cancelled" || status === "error";
}

function setStatus(taskId: string, status: TaskStatus, patch: Partial<Task> = {}) {
  patchTask(taskId, { ...patch, status, ...(finishedStatus(status) ? { finishedAt: iso(now()) } : {}) });
  emit(taskId, { type: "status", actor: "system", status });
  if (finishedStatus(status) && clock === null) {
    for (const l of s().listeners.get(taskId) ?? []) l.onEnd();
    s().listeners.delete(taskId);
  }
}

const node = (taskId: string, n: "task" | "forge" | "checks" | "hawk" | "you" | "merge", state: "idle" | "active" | "done" | "failed" | "warn") =>
  emit(taskId, { type: "node", actor: "system", node: n, state });

// ---------- Scripted runs ----------

type Step = { delay: number; run: () => void } | { delay: number; pause: true };

const step = (delay: number, run: () => void): Step => ({ delay, run });
const pause: Step = { delay: 0, pause: true };

function toolSteps(taskId: string, actor: Actor, tools: ToolStep[]): Step[] {
  return tools.flatMap((tool) => {
    const toolUseId = id();
    return [
      step(550, () => emit(taskId, { type: "tool_use", actor, toolUseId, name: tool.name, input: tool.input })),
      step(650, () => emit(taskId, { type: "tool_result", actor, toolUseId, output: tool.output, isError: Boolean(tool.isError) })),
    ];
  });
}

function verdictFor(L: Locale, c: ScenarioContent, approved: boolean, round: number): Verdict {
  return approved
    ? { approved: true, risk: "low", summary: c.approvedSummary, issues: [], suggestedRule: c.suggestedRule }
    : { approved: false, risk: round >= 3 ? "high" : "medium", summary: c.concernsSummary || tr(L, "Not there yet.", "Ainda não."), issues: c.issues };
}

/** Checks → Hawk, then either review or another Forge round. */
function reviewSteps(taskId: string, c: ScenarioContent, round: number): Step[] {
  const L = s().locale;
  const task = () => s().tasks.find((t) => t.id === taskId)!;
  const checks = round === 1 ? c.firstChecks : c.firstChecks.map((x) => ({ ...x, ok: true, output: x.output && !x.ok ? "" : x.output }));
  const approved = round >= c.approveOnRound;
  const failed = checks.filter((x) => !x.ok).length;
  const steps: Step[] = [
    step(400, () => emit(taskId, { type: "handoff", actor: "forge", to: "checks", label: "" })),
    step(200, () => node(taskId, "checks", "active")),
    step(1600, () => {
      emit(taskId, { type: "checks", actor: "checks", results: checks });
      patchTask(taskId, { checks });
      node(taskId, "checks", failed ? "failed" : "done");
    }),
    step(300, () => node(taskId, "hawk", "active")),
    step(500, () => emit(taskId, { type: "text", actor: "hawk", text: tr(L, "Reading the diff and the check results.", "Lendo o diff e os resultados das verificações.") })),
    ...toolSteps(taskId, "hawk", [{ name: "Read", input: { file_path: c.diff[0]?.path ?? "README.md" }, output: "…" }]),
    step(900, () => {
      const verdict = verdictFor(L, c, approved && failed === 0, round);
      emit(taskId, { type: "verdict", actor: "hawk", verdict, round });
      patchTask(taskId, { verdict });
      node(taskId, "hawk", verdict.approved ? "done" : "warn");
    }),
  ];
  if ((approved && failed === 0) || round >= task().maxRounds) {
    steps.push(
      step(300, () => {
        node(taskId, "you", "active");
        setStatus(taskId, "review");
      }),
    );
    return steps;
  }
  steps.push(
    step(400, () => emit(taskId, { type: "handoff", actor: "hawk", to: "forge", label: String(c.issues.length + failed) })),
    step(200, () => {
      patchTask(taskId, { round: round + 1 });
      emit(taskId, { type: "round", actor: "system", round: round + 1 });
    }),
    ...fixSteps(taskId, c, round + 1),
  );
  return steps;
}

function fixSteps(taskId: string, c: ScenarioContent, round: number, notes?: string): Step[] {
  const L = s().locale;
  return [
    step(300, () => node(taskId, "forge", "active")),
    step(600, () => emit(taskId, { type: "text", actor: "forge", text: notes ? tr(L, "Applying your notes.", "Aplicando suas observações.") : c.fixIntro })),
    ...toolSteps(taskId, "forge", c.fix.length ? c.fix : c.build.slice(0, 1)),
    step(500, () => {
      const summary = notes ? tr(L, `Done. ${notes}`, `Pronto. ${notes}`) : c.fixSummary || c.summary;
      emit(taskId, { type: "step_done", actor: "forge", summary, costUsd: 0, durationMs: 4200 });
      patchTask(taskId, { summary, costUsd: s().tasks.find((t) => t.id === taskId)!.costUsd + 0.07 });
      node(taskId, "forge", "done");
    }),
    ...reviewSteps(taskId, c, round),
  ];
}

/** The whole run: explore → (question) → build → review loop. */
function runSteps(taskId: string, c: ScenarioContent, intro: string): Step[] {
  const L = s().locale;
  const start: Step[] = [
    step(200, () => setStatus(taskId, "running")),
    step(100, () => node(taskId, "task", "done")),
    step(100, () => {
      patchTask(taskId, { round: 1, branch: `fb/${taskId.slice(0, 5)}`, baseBranch: "main" });
      emit(taskId, { type: "round", actor: "system", round: 1 });
    }),
    step(300, () => node(taskId, "forge", "active")),
    step(600, () => emit(taskId, { type: "text", actor: "forge", text: intro })),
    ...toolSteps(taskId, "forge", c.explore),
  ];
  const question = c.question;
  const build: Step[] = [
    step(600, () => emit(taskId, { type: "text", actor: "forge", text: c.plan })),
    ...toolSteps(taskId, "forge", c.build),
    step(500, () => {
      emit(taskId, { type: "step_done", actor: "forge", summary: c.summary, costUsd: 0, durationMs: 9100 });
      patchTask(taskId, { summary: c.summary, costUsd: 0.31 });
      node(taskId, "forge", "done");
    }),
    ...reviewSteps(taskId, c, 1),
  ];
  if (!question) return [...start, ...build];
  return [
    ...start,
    step(700, () => {
      emit(taskId, { type: "question", actor: "forge", question });
      node(taskId, "forge", "warn");
      node(taskId, "you", "active");
      setStatus(taskId, "waiting", { question });
    }),
    pause,
    step(200, () => node(taskId, "forge", "active")),
    ...build,
  ];
  void L;
}

function play(taskId: string, steps: Step[]): void {
  const st = s();
  let i = 0;
  const next = () => {
    const current = steps[i++];
    if (!current) return;
    const timer = setTimeout(() => {
      if ("pause" in current) {
        st.pending.set(taskId, steps.slice(i));
        return;
      }
      current.run();
      next();
    }, current.delay);
    st.timers.set(taskId, [...(st.timers.get(taskId) ?? []), timer]);
  };
  next();
}

function stopTimers(taskId: string) {
  for (const t of s().timers.get(taskId) ?? []) clearTimeout(t);
  s().timers.delete(taskId);
  s().pending.delete(taskId);
}

/** Plays steps instantly with past timestamps (for seeding). Returns what is left after a pause. */
function runInstant(taskId: string, steps: Step[], startMs: number): Step[] {
  clock = startMs;
  let i = 0;
  for (; i < steps.length; i++) {
    const current = steps[i]!;
    clock += current.delay * 1.6;
    if ("pause" in current) {
      i++;
      break;
    }
    current.run();
  }
  clock = null;
  return steps.slice(i);
}

// ---------- Lead-planned runs (Docs team) ----------

const at = (taskId: string, n: string, state: NodeState) => emit(taskId, { type: "node", actor: "system", node: n, state });

function addCost(taskId: string, usd: number) {
  patchTask(taskId, { costUsd: s().tasks.find((t) => t.id === taskId)!.costUsd + usd });
}

/** The run starts and the Lead plans who does what. */
function leadPlanSteps(taskId: string, intro: string, look: ToolStep[], summary: string, steps: FlowStep[], reasons: Record<string, string>): Step[] {
  return [
    step(200, () => setStatus(taskId, "running")),
    step(100, () => at(taskId, "task", "done")),
    step(100, () => {
      patchTask(taskId, { round: 1, branch: `fb/${taskId.slice(0, 5)}`, baseBranch: "main" });
      emit(taskId, { type: "round", actor: "system", round: 1 });
    }),
    step(300, () => at(taskId, "lead", "active")),
    step(600, () => emit(taskId, { type: "text", actor: "lead", text: intro })),
    ...toolSteps(taskId, "lead", look),
    step(900, () => {
      patchTask(taskId, { flow: { ...LEAD_DECIDES, steps: [LEAD_DECIDES.steps[0]!, ...steps] }, plan: { by: "lead", summary, reasons, revisions: 0 } });
      emit(taskId, { type: "plan", actor: "lead", summary, steps, reasons });
      addCost(taskId, 0.04);
      at(taskId, "lead", "done");
    }),
  ];
}

/** A builder step: it works on files and says what it did. */
function writeSteps(taskId: string, stepId: string, actor: string, intro: string, tools: ToolStep[], summary: string): Step[] {
  return [
    step(300, () => at(taskId, stepId, "active")),
    step(600, () => emit(taskId, { type: "text", actor, text: intro })),
    ...toolSteps(taskId, actor, tools),
    step(500, () => {
      emit(taskId, { type: "step_done", actor, summary, costUsd: 0, durationMs: 8300 });
      patchTask(taskId, { summary });
      addCost(taskId, 0.12);
      at(taskId, stepId, "done");
    }),
  ];
}

/** A reviewer step: it reads the work and gives its verdict. */
function editSteps(taskId: string, stepId: string, actor: string, file: string, verdict: Verdict, round: number): Step[] {
  const L = s().locale;
  return [
    step(300, () => at(taskId, stepId, "active")),
    step(500, () => emit(taskId, { type: "text", actor, text: tr(L, "Reading the changes next to the other documents.", "Lendo as mudanças junto com os outros documentos.") })),
    ...toolSteps(taskId, actor, [{ name: "Read", input: { file_path: file }, output: "…" }]),
    step(900, () => {
      emit(taskId, { type: "verdict", actor, verdict, round });
      patchTask(taskId, { verdict });
      addCost(taskId, 0.05);
      at(taskId, stepId, verdict.approved ? "done" : "warn");
    }),
  ];
}

function sendBackSteps(taskId: string, from: { step: string; actor: string }, to: { step: string; actor: string }, count: number): Step[] {
  return [
    step(400, () => emit(taskId, { type: "handoff", actor: from.actor, to: to.actor, label: String(count), fromStep: from.step, toStep: to.step })),
    step(200, () => {
      const round = s().tasks.find((t) => t.id === taskId)!.round + 1;
      patchTask(taskId, { round });
      emit(taskId, { type: "round", actor: "system", round });
    }),
  ];
}

const toReview = (taskId: string): Step =>
  step(300, () => {
    at(taskId, "you", "active");
    setStatus(taskId, "review");
  });

const WRITER = { id: "writer", type: "agent", agentId: "writer" } as const satisfies FlowStep;
const EDITOR = { id: "editor", type: "agent", agentId: "editor", sendBackTo: "writer" } as const satisfies FlowStep;

/** The getting started guide: the Editor stays stuck on one point, and the Lead changes the plan. */
function guideRun(taskId: string): Step[] {
  const L = s().locale;
  const guide = "docs/getting-started.md";
  const writer = { step: "writer", actor: "writer" };
  const editor = { step: "editor", actor: "editor" };
  const writer2: FlowStep = { id: "writer-2", type: "agent", agentId: "writer" };
  const editor2: FlowStep = { id: "editor-2", type: "agent", agentId: "editor", sendBackTo: "writer-2" };
  return [
    ...leadPlanSteps(
      taskId,
      tr(L, "Seeing what the help center already has.", "Vendo o que a central de ajuda já tem."),
      [{ name: "Glob", input: { pattern: "docs/**/*.md" }, output: "docs/faq.md\ndocs/collections.md\ndocs/pricing.md" }],
      tr(L, "A new guide: Writer writes it, Editor checks it against the other documents.", "Um guia novo: o Writer escreve e o Editor confere com os outros documentos."),
      [WRITER, EDITOR],
      {
        writer: tr(L, "A guide for new users, in the tone the FAQ already uses.", "Um guia para quem está começando, no tom que o FAQ já usa."),
        editor: tr(L, "Menu names and links must match the other documents.", "Nomes de menu e links precisam bater com os outros documentos."),
      },
    ),
    ...writeSteps(
      taskId,
      "writer",
      "writer",
      tr(L, "Reading the FAQ to match its tone, then writing the guide.", "Lendo o FAQ para seguir o tom e depois escrevendo o guia."),
      [
        { name: "Read", input: { file_path: "docs/faq.md" }, output: "# Frequently asked questions\n…" },
        { name: "Write", input: { file_path: guide }, output: "File created." },
      ],
      tr(L, "Wrote `getting-started.md`: four steps from sign-up to the first published article.", "Escrevi o `getting-started.md`: quatro passos do cadastro ao primeiro artigo publicado."),
    ),
    ...editSteps(
      taskId,
      "editor",
      "editor",
      guide,
      {
        approved: false,
        risk: "medium",
        summary: tr(L, "Clear, but one menu name is wrong and a step has no example.", "Claro, mas um nome de menu está errado e um passo não tem exemplo."),
        issues: [
          { severity: "high", message: tr(L, "Step 2 says “Settings › Team”, but the app and faq.md call it “Workspace › Members”.", "O passo 2 diz “Configurações › Time”, mas o app e o faq.md chamam de “Espaço › Membros”."), file: guide, line: 13 },
          { severity: "medium", message: tr(L, "No example for inviting someone.", "Falta um exemplo de convite."), file: guide, line: 15 },
        ],
      },
      1,
    ),
    ...sendBackSteps(taskId, editor, writer, 2),
    ...writeSteps(
      taskId,
      "writer",
      "writer",
      tr(L, "Fixing the menu name and adding an example.", "Corrigindo o nome do menu e adicionando um exemplo."),
      [{ name: "Edit", input: { file_path: guide }, output: "The file has been updated." }],
      tr(L, "Step 2 now says “Workspace › Members” and shows an example invite. Added SSO to step 1.", "O passo 2 agora diz “Espaço › Membros” e mostra um convite de exemplo. Coloquei o SSO no passo 1."),
    ),
    ...editSteps(
      taskId,
      "editor",
      "editor",
      guide,
      {
        approved: false,
        risk: "medium",
        summary: tr(L, "The menu is fixed, but the guide now promises SSO to everyone.", "O menu foi corrigido, mas agora o guia promete SSO para todos."),
        issues: [
          { severity: "high", message: tr(L, "SSO is only on the Business plan (pricing.md). Step 1 offers it to every account.", "O SSO só existe no plano Business (pricing.md). O passo 1 oferece para todas as contas."), file: guide, line: 7 },
        ],
      },
      2,
    ),
    // The Editor's last round, still not approved: the Lead decides.
    step(400, () => at(taskId, "lead", "active")),
    step(700, () => emit(taskId, { type: "text", actor: "lead", text: tr(L, "The review is stuck. Checking what's left.", "A revisão travou. Vendo o que falta.") })),
    ...toolSteps(taskId, "lead", [{ name: "Read", input: { file_path: "docs/pricing.md" }, output: tr(L, "## Business\n- Single sign-on (SSO)\n- Custom domain", "## Business\n- Login único (SSO)\n- Domínio próprio") }]),
    step(900, () => {
      const steps = [writer2, editor2];
      const why = tr(
        L,
        "What's left is about plans, not wording: Writer moves SSO to a Plans section based on pricing.md, and the Editor checks it once more.",
        "O que falta é sobre planos, não sobre texto: o Writer leva o SSO para uma seção de Planos com base no pricing.md, e o Editor confere mais uma vez.",
      );
      const task = s().tasks.find((t) => t.id === taskId)!;
      const plan = task.plan!;
      patchTask(taskId, {
        flow: { ...task.flow!, steps: [...task.flow!.steps, ...steps] },
        plan: {
          ...plan,
          checkpoints: 1,
          reasons: {
            ...plan.reasons,
            "writer-2": tr(L, "Move SSO to a Plans section, as pricing.md says.", "Levar o SSO para uma seção de Planos, como diz o pricing.md."),
            "editor-2": tr(L, "One more look at the plans part.", "Mais uma olhada na parte de planos."),
          },
        },
        maxRounds: task.round + 2,
      });
      emit(taskId, { type: "checkpoint", actor: "lead", kind: "stuck", action: "replan", why, steps });
      addCost(taskId, 0.03);
      at(taskId, "lead", "done");
    }),
    step(200, () => {
      const round = s().tasks.find((t) => t.id === taskId)!.round + 1;
      patchTask(taskId, { round });
      emit(taskId, { type: "round", actor: "system", round });
    }),
    ...writeSteps(
      taskId,
      "writer-2",
      "writer",
      tr(L, "Checking pricing.md and moving SSO to its own section.", "Conferindo o pricing.md e levando o SSO para uma seção própria."),
      [
        { name: "Read", input: { file_path: "docs/pricing.md" }, output: "…" },
        { name: "Edit", input: { file_path: guide }, output: "The file has been updated." },
        { name: "Edit", input: { file_path: "docs/faq.md" }, output: "The file has been updated." },
      ],
      tr(L, "SSO and custom domains are now in a Plans section that links to pricing.md. The FAQ links to the guide.", "SSO e domínio próprio agora ficam numa seção de Planos com link para o pricing.md. O FAQ aponta para o guia."),
    ),
    ...editSteps(
      taskId,
      "editor-2",
      "editor",
      guide,
      {
        approved: true,
        risk: "low",
        summary: tr(L, "Clear, accurate and consistent with the FAQ and pricing. Ready to publish.", "Claro, correto e consistente com o FAQ e os preços. Pronto para publicar."),
        issues: [],
        suggestedRule: tr(L, "Mention plan limits only in a Plans section that links to pricing.md.", "Citar limites de plano só numa seção de Planos com link para o pricing.md."),
      },
      3,
    ),
    toReview(taskId),
  ];
}

/** New prices in the FAQ: the Writer asks about the currency, the Lead suggests an answer and waits for you. */
function faqRun(taskId: string): Step[] {
  const L = s().locale;
  const options = [tr(L, "Reais (R$)", "Reais (R$)"), tr(L, "Dollars (US$)", "Dólares (US$)"), tr(L, "Both", "Os dois")];
  const why = tr(
    L,
    "pricing.md is the source of truth and every other page uses R$. Not sure if the FAQ also serves customers abroad, so it's your call.",
    "O pricing.md é a fonte oficial e as outras páginas usam R$. Não sei se o FAQ também atende clientes de fora, então a decisão é sua.",
  );
  const question = {
    question: tr(L, "The FAQ quotes prices in dollars, but pricing.md is in reais. Which currency should the FAQ use?", "O FAQ mostra os preços em dólar, mas o pricing.md está em reais. Qual moeda o FAQ deve usar?"),
    options,
    askedBy: "writer",
  };
  return [
    ...leadPlanSteps(
      taskId,
      tr(L, "Looking for every place that shows a price.", "Procurando todo lugar que mostra preço."),
      [{ name: "Grep", input: { pattern: "US\\$|R\\$" }, output: "docs/faq.md:20\ndocs/pricing.md:4\ndocs/pricing.md:9" }],
      tr(L, "A small text change: Writer updates the FAQ, Editor checks the numbers.", "Uma mudança pequena de texto: o Writer atualiza o FAQ e o Editor confere os números."),
      [WRITER, EDITOR],
      {
        writer: tr(L, "Only the FAQ quotes the old prices.", "Só o FAQ mostra os preços antigos."),
        editor: tr(L, "Prices must match pricing.md exactly.", "Os preços precisam bater exatamente com o pricing.md."),
      },
    ),
    step(300, () => at(taskId, "writer", "active")),
    step(600, () => emit(taskId, { type: "text", actor: "writer", text: tr(L, "Comparing the FAQ with the pricing page.", "Comparando o FAQ com a página de preços.") })),
    ...toolSteps(taskId, "writer", [
      { name: "Read", input: { file_path: "docs/faq.md" }, output: "…" },
      { name: "Read", input: { file_path: "docs/pricing.md" }, output: "…" },
    ]),
    step(700, () => {
      emit(taskId, { type: "question", actor: "writer", question });
      addCost(taskId, 0.06);
    }),
    // The Lead reads the question first.
    step(300, () => at(taskId, "lead", "active")),
    step(1200, () => {
      emit(taskId, { type: "checkpoint", actor: "lead", kind: "question", action: "you", why, answer: options[0], to: "writer" });
      const task = s().tasks.find((t) => t.id === taskId)!;
      patchTask(taskId, { plan: { ...task.plan!, answers: 1 } });
      addCost(taskId, 0.02);
      at(taskId, "lead", "done");
      at(taskId, "writer", "warn");
      at(taskId, "you", "active");
      setStatus(taskId, "waiting", { question: { ...question, suggested: 0, leadAnswer: { by: "lead", answer: options[0]!, why } } });
    }),
    pause,
    ...writeSteps(
      taskId,
      "writer",
      "writer",
      tr(L, "Updating the prices in the FAQ.", "Atualizando os preços no FAQ."),
      [{ name: "Edit", input: { file_path: "docs/faq.md" }, output: "The file has been updated." }],
      tr(L, "The FAQ now shows R$ 49 and R$ 149, the same as pricing.md.", "O FAQ agora mostra R$ 49 e R$ 149, igual ao pricing.md."),
    ),
    ...editSteps(taskId, "editor", "editor", "docs/faq.md", { approved: true, risk: "low", summary: tr(L, "Prices match pricing.md. Ready to publish.", "Os preços batem com o pricing.md. Pronto para publicar."), issues: [] }, 1),
    toReview(taskId),
  ];
}

/** A new task in the Docs workspace: the Lead plans Writer → Editor, and the document is written. */
function docRun(taskId: string, title: string, path: string): Step[] {
  const L = s().locale;
  return [
    ...leadPlanSteps(
      taskId,
      tr(L, `On it: “${title}”. Seeing what the folder already has.`, `Começando: “${title}”. Vendo o que a pasta já tem.`),
      [{ name: "Glob", input: { pattern: "docs/**/*.md" }, output: "docs/faq.md\ndocs/collections.md\ndocs/pricing.md" }],
      tr(L, "Writer writes it, Editor checks it against the other documents.", "O Writer escreve e o Editor confere com os outros documentos."),
      [WRITER, EDITOR],
      {
        writer: tr(L, "A new document, in the tone the folder already uses.", "Um documento novo, no tom que a pasta já usa."),
        editor: tr(L, "Terms and links must match the other documents.", "Termos e links precisam bater com os outros documentos."),
      },
    ),
    ...writeSteps(
      taskId,
      "writer",
      "writer",
      tr(L, "Writing it in the folder's tone.", "Escrevendo no tom da pasta."),
      [
        { name: "Read", input: { file_path: "docs/faq.md" }, output: "…" },
        { name: "Write", input: { file_path: path }, output: "File created." },
      ],
      tr(L, `Wrote \`${path}\`.`, `Escrevi o \`${path}\`.`),
    ),
    ...editSteps(taskId, "editor", "editor", path, { approved: true, risk: "low", summary: tr(L, "Clear and consistent with the other documents. Ready to publish.", "Claro e consistente com os outros documentos. Pronto para publicar."), issues: [] }, 1),
    toReview(taskId),
  ];
}

function docFor(L: ReturnType<typeof s>["locale"], title: string): { path: string; diff: DiffFile[] } {
  const slug = title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "new-doc";
  const path = `docs/${slug}.md`;
  const body = tr(
    L,
    `# ${title}\n\nA short introduction: what this page covers and who it is for.\n\n## How it works\n\nOne idea per paragraph, with an example for each step.\n\n## Next steps\n\n- [Getting started](getting-started.md)\n- [Answers to common questions](faq.md)`,
    `# ${title}\n\nUma introdução curta: o que esta página cobre e para quem é.\n\n## Como funciona\n\nUma ideia por parágrafo, com um exemplo para cada passo.\n\n## Próximos passos\n\n- [Primeiros passos](getting-started.md)\n- [Respostas para dúvidas comuns](faq.md)`,
  );
  return { path, diff: [docPatch(path, body)] };
}

/** A workspace whose team has a Writer and an Editor and lets the Lead decide. */
function isDocsWorkspace(workspaceId: string, flowId?: string): boolean {
  const st = s();
  const w = st.workspaces.find((x) => x.id === workspaceId);
  const team = w?.crewMode === "team" ? st.teams.find((x) => x.id === w.teamId) : undefined;
  if (!team || !["lead", "writer", "editor"].every((m) => team.members.some((a) => a.id === m))) return false;
  return (flowId ?? w?.defaultFlowId ?? team.planning) === LEAD_DECIDES_ID;
}

// ---------- Seed ----------

function seed(locale: Locale): Store {
  const L = locale;
  const t0 = Date.now();
  const ago = (min: number) => t0 - min * 60_000;
  const ws = (name: string, color: Workspace["color"], description: string, crewMode: Workspace["crewMode"], createdMin: number): Workspace => ({
    id: id(),
    name,
    color,
    description,
    crewMode,
    archived: false,
    createdAt: iso(ago(createdMin)),
  });
  const acme = ws("Acme", "info", tr(L, "Work", "Trabalho"), "custom", 9000);
  const shop = ws("Loja da Ana", "success", "Freela", "default", 8000);
  const personal = ws(tr(L, "Personal", "Pessoal"), "violet", tr(L, "Studies", "Estudos"), "default", 7000);
  // A docs workspace with a ready-made team: the Lead plans each task.
  const docsTpl = TEAM_TEMPLATES.find((x) => x.id === "docs")!;
  const docsTeam: Team = {
    id: id(),
    name: docsTpl.name[L],
    description: docsTpl.description[L],
    planning: docsTpl.planning,
    kind: docsTpl.kind,
    commands: docsTpl.commands,
    about: tr(L, "The help center of our product, in Markdown.", "A central de ajuda do nosso produto, em Markdown."),
    members: templateMembers(docsTpl, L),
    templateId: docsTpl.id,
    createdAt: iso(ago(6500)),
  };
  const docs: Workspace = {
    ...ws(tr(L, "Help center", "Central de ajuda"), "warning", tr(L, "Product", "Produto"), "team", 6500),
    teamId: docsTeam.id,
    defaultFlowId: LEAD_DECIDES_ID,
  };
  const repo = (w: Workspace, name: string, checks: CheckCommand[]): Repo => ({
    id: id(),
    workspaceId: w.id,
    name,
    path: `~/projects/${name}`,
    checks,
    createdAt: w.createdAt,
  });
  const acmeWeb = repo(acme, "acme-web", WEB_CHECKS);
  const acmeApi = repo(acme, "acme-api", API_CHECKS);
  const lojaRepo = repo(shop, "loja-ana", SHOP_CHECKS);
  const blog = repo(personal, "blog", BLOG_CHECKS);
  const helpCenter = { ...repo(docs, "help-center", []), path: "~/Documents/help-center" };

  const defaults: Agent[] = [
    { id: "forge", name: "Forge", role: "builder", builtIn: true, provider: "claude-code", personality: "balanced", instructions: tr(L, "Keep changes small and focused.", "Mantenha as mudanças pequenas e focadas.") },
    { id: "hawk", name: "Hawk", role: "reviewer", builtIn: true, provider: "claude-code", personality: "strict", instructions: tr(L, "Block on failing checks and real bugs.", "Bloqueie verificações falhando e bugs de verdade.") },
    { id: "lead", name: "Lead", role: "lead", builtIn: true, provider: "claude-code", personality: "balanced", instructions: tr(L, "Pick the smallest team that does the task well.", "Escolha o menor time que faça a tarefa bem.") },
  ];
  const acmeCrew: Agent[] = [
    { ...defaults[0]!, customized: false },
    { ...defaults[1]!, instructions: tr(L, "Block any change without a test. This API is public.", "Bloqueie qualquer mudança sem teste. Esta API é pública."), customized: true },
    { ...defaults[2]!, customized: false },
  ];

  store = {
    locale: L,
    workspaces: [acme, shop, personal, docs],
    repos: [acmeWeb, acmeApi, lojaRepo, blog, helpCenter],
    tasks: [],
    events: new Map(),
    diffs: new Map(),
    scenarios: new Map(),
    defaults,
    overrides: new Map([[acme.id, acmeCrew]]),
    flows: [],
    teams: [docsTeam],
    rules: [
      { id: id(), scope: "global", workspaceId: null, repoId: null, text: tr(L, "Conventional commits, in English", "Conventional commits, em inglês"), enabled: true, source: "you", createdAt: iso(ago(6000)) },
      { id: id(), scope: "workspace", workspaceId: acme.id, repoId: null, text: tr(L, "Never use `any` in TypeScript", "Nunca usar `any` no TypeScript"), enabled: true, source: "you", createdAt: iso(ago(5000)) },
      { id: id(), scope: "repo", workspaceId: null, repoId: acmeApi.id, text: tr(L, "Dates are UTC in the API", "Datas em UTC na API"), enabled: true, source: "hawk", createdAt: iso(ago(3000)) },
    ],
    pending: new Map(),
    timers: new Map(),
    listeners: new Map(),
  };

  const add = (r: Repo, prompt: string, c: ScenarioContent, startMin: number, maxRounds = 3) => {
    const task = newTask(r, prompt, L, maxRounds, iso(ago(startMin)));
    store!.tasks.unshift(task);
    store!.scenarios.set(task.id, c);
    store!.diffs.set(task.id, c.diff);
    return task;
  };

  // Merged earlier.
  const done1 = add(blog, tr(L, "Add a dark mode toggle", "Adicionar botão de modo escuro"), simpleDoneScenario(L, tr(L, "dark mode toggle", "botão de modo escuro"), ["src/components/ThemeToggle.tsx", "src/app/layout.tsx"]), 1500);
  runInstant(done1.id, runSteps(done1.id, store.scenarios.get(done1.id)!, tr(L, "Looking at the layout first.", "Olhando o layout primeiro.")), ago(1500));
  mergeNow(done1.id, ago(1490));
  const done2 = add(acmeWeb, tr(L, "Migrate icons to lucide", "Migrar ícones para o lucide"), simpleDoneScenario(L, tr(L, "lucide icons", "ícones do lucide"), ["src/components/icons.tsx", "package.json"]), 160);
  runInstant(done2.id, runSteps(done2.id, store.scenarios.get(done2.id)!, tr(L, "Finding every icon import.", "Procurando todas as importações de ícones.")), ago(160));
  mergeNow(done2.id, ago(150));

  // Waiting for review.
  const pix = add(lojaRepo, tr(L, "Switch the payment gateway to Pix", "Trocar o gateway de pagamento para Pix"), pixScenario(L), 40);
  runInstant(pix.id, runSteps(pix.id, pixScenario(L), tr(L, "Checking how payments work today.", "Vendo como os pagamentos funcionam hoje.")), ago(40));
  const api = add(acmeApi, tr(L, "Validate pagination params in the API", "Validar parâmetros de paginação na API"), apiValidationScenario(L), 12);
  runInstant(api.id, runSteps(api.id, apiValidationScenario(L), tr(L, "Looking for routes that read query params.", "Procurando rotas que leem parâmetros.")), ago(12));
  // This workspace lets Forge decide small things on its own and report them.
  patchTask(api.id, {
    assumptions: [
      tr(L, "An invalid ?page answers 400 with zod's message, like the other routes", "?page inválido responde 400 com a mensagem do zod, como as outras rotas"),
      tr(L, "At most 100 rows per page, to avoid huge responses", "No máximo 100 linhas por página, para evitar respostas gigantes"),
    ],
    assumptionsAck: false,
  });

  // Docs team: a guide where the Lead stepped in, waiting for review.
  const guide = add(helpCenter, tr(L, "Write a getting started guide", "Escrever um guia de primeiros passos"), { ...simpleDoneScenario(L, "", []), diff: guideDiff(L) }, 25, 2);
  patchTask(guide.id, { flow: LEAD_DECIDES });
  runInstant(guide.id, guideRun(guide.id), ago(25));
  // The Writer asked; the Lead suggested an answer and waits for you.
  const faq = add(helpCenter, tr(L, "Update the FAQ with the new prices", "Atualizar o FAQ com os novos preços"), { ...simpleDoneScenario(L, "", []), diff: faqDiff(L) }, 5, 2);
  patchTask(faq.id, { flow: LEAD_DECIDES });
  store.pending.set(faq.id, runInstant(faq.id, faqRun(faq.id), ago(5)));

  // Waiting for an answer.
  const pag = add(acmeWeb, tr(L, "Add pagination to the users table", "Adicionar paginação à tabela de usuários"), paginationScenario(L), 3);
  const rest = runInstant(pag.id, runSteps(pag.id, paginationScenario(L), tr(L, "I'll start by looking at how the users table loads data.", "Vou começar vendo como a tabela de usuários carrega os dados.")), ago(3));
  store.pending.set(pag.id, rest);

  // Waiting for a plan to be approved.
  const settings = add(acmeWeb, tr(L, "Build the user settings page", "Criar a página de configurações do usuário"), settingsScenario(L), 1);
  const restSettings = runInstant(settings.id, runSteps(settings.id, settingsScenario(L), tr(L, "Let me see how pages and auth are set up.", "Deixa eu ver como as páginas e a autenticação estão montadas.")), ago(1));
  store.pending.set(settings.id, restSettings);

  return store;
}

function newTask(r: Repo, prompt: string, locale: Locale, maxRounds: number, createdAt: string): Task {
  const firstLine = prompt.split("\n")[0]!.trim();
  return {
    id: id(),
    workspaceId: r.workspaceId,
    repoId: r.id,
    prompt,
    title: firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine,
    locale,
    status: "queued",
    round: 0,
    maxRounds,
    branch: null,
    baseBranch: null,
    question: null,
    verdict: null,
    checks: null,
    summary: null,
    costUsd: 0,
    error: null,
    createdAt,
    updatedAt: createdAt,
    finishedAt: null,
  };
}

function mergeNow(taskId: string, atMs?: number) {
  if (atMs) clock = atMs;
  const task = s().tasks.find((t) => t.id === taskId)!;
  node(taskId, "you", "done");
  node(taskId, "merge", "done");
  emit(taskId, { type: "merged", actor: "you", branch: task.branch ?? "fb/demo" });
  setStatus(taskId, "merged");
  if (atMs) clock = null;
}

// ---------- API ----------

const ok = <T>(v: T) => Promise.resolve(clone(v));
const fail = (message: string) => Promise.reject(new Error(message));

function crewFor(workspaceId?: string): Agent[] {
  const st = s();
  const w = workspaceId ? st.workspaces.find((x) => x.id === workspaceId) : undefined;
  if (w?.crewMode === "team") {
    const team = st.teams.find((x) => x.id === w.teamId);
    if (team) return team.members.map((m) => ({ ...m, builtIn: false, customized: false }));
  }
  if (!w || w.crewMode !== "custom") return st.defaults;
  return st.overrides.get(w.id) ?? st.defaults.map((a) => ({ ...a, customized: false }));
}

function sameAgent(a: Agent, b: Agent) {
  return a.name === b.name && a.provider === b.provider && a.personality === b.personality && a.instructions === b.instructions;
}

function placeRule(scope: RuleScope, target: string | null) {
  return { scope, workspaceId: scope === "workspace" ? target : null, repoId: scope === "repo" ? target : null };
}

export const demoApi: Api = {
  providers: () =>
    ok<ProviderInfo[]>([
      { id: "claude-code", label: "Claude Code", available: true, detail: "Demo · simulated" },
      { id: "codex", label: "Codex", available: true, detail: "Demo · simulated" },
      { id: "mock", label: "Mock (no AI)", available: true, detail: "Scripted crew" },
    ]),

  workspaces: () => ok(s().workspaces),
  createWorkspace: (input: CreateWorkspaceInput) => {
    const st = s();
    const w: Workspace = {
      id: id(),
      name: input.name,
      description: input.description ?? "",
      color: input.color,
      crewMode: input.teamId ? "team" : input.crewFrom ? "custom" : "default",
      ...(input.teamId ? { teamId: input.teamId } : {}),
      archived: false,
      createdAt: iso(Date.now()),
    };
    st.workspaces.push(w);
    if (input.crewFrom) st.overrides.set(w.id, clone(crewFor(input.crewFrom)));
    for (const p of input.repoPaths ?? []) {
      st.repos.push({ id: id(), workspaceId: w.id, name: p.split("/").filter(Boolean).at(-1) ?? p, path: p, checks: WEB_CHECKS, createdAt: w.createdAt });
    }
    return ok(w);
  },
  updateWorkspace: (wsId, data) => {
    const st = s();
    const i = st.workspaces.findIndex((w) => w.id === wsId);
    if (i < 0) return fail("Workspace not found");
    if (data.crewMode === "custom" && !st.overrides.has(wsId)) st.overrides.set(wsId, st.defaults.map((a) => ({ ...a, customized: false })));
    st.workspaces[i] = { ...st.workspaces[i]!, ...data };
    return ok(st.workspaces[i]!);
  },
  removeWorkspace: (wsId) => {
    const st = s();
    if (st.tasks.some((t) => t.workspaceId === wsId && !finishedStatus(t.status))) return fail("This workspace has open tasks. Merge, discard or wait for them first.");
    st.workspaces = st.workspaces.filter((w) => w.id !== wsId);
    st.repos = st.repos.filter((r) => r.workspaceId !== wsId);
    st.tasks = st.tasks.filter((t) => t.workspaceId !== wsId);
    return ok(undefined);
  },

  repos: (workspaceId) => ok(s().repos.filter((r) => !workspaceId || r.workspaceId === workspaceId)),
  addRepo: (workspaceId, path) => {
    const r: Repo = { id: id(), workspaceId, name: path.split("/").filter(Boolean).at(-1) ?? path, path, checks: WEB_CHECKS, createdAt: iso(Date.now()) };
    s().repos.push(r);
    return ok(r);
  },
  updateRepo: (repoId, data) => {
    const st = s();
    const r = st.repos.find((x) => x.id === repoId);
    if (!r) return fail("Repo not found");
    if (data.checks) r.checks = data.checks;
    if (data.workspaceId) {
      r.workspaceId = data.workspaceId;
      for (const t of st.tasks) if (t.repoId === repoId) t.workspaceId = data.workspaceId;
    }
    return ok(r);
  },
  removeRepo: (repoId) => {
    const st = s();
    st.repos = st.repos.filter((r) => r.id !== repoId);
    st.tasks = st.tasks.filter((t) => t.repoId !== repoId);
    return ok(undefined);
  },

  agents: (workspaceId) => ok(crewFor(workspaceId)),
  updateAgent: (agentId, data, workspaceId) => {
    const st = s();
    if (!workspaceId) {
      st.defaults = st.defaults.map((a) => (a.id === agentId ? { ...a, ...data, customized: undefined } : a));
      return ok(st.defaults.find((a) => a.id === agentId)!);
    }
    const w = st.workspaces.find((x) => x.id === workspaceId)!;
    w.crewMode = "custom";
    const crew = clone(crewFor(workspaceId)).map((a) => {
      if (a.id !== agentId) return a;
      const next = { ...a, ...data };
      return { ...next, customized: !sameAgent(next, st.defaults.find((d) => d.id === agentId)!) };
    });
    st.overrides.set(workspaceId, crew);
    return ok(crew.find((a) => a.id === agentId)!);
  },
  resetAgent: (agentId, workspaceId) => {
    const st = s();
    const crew = clone(crewFor(workspaceId)).map((a) => (a.id === agentId ? { ...st.defaults.find((d) => d.id === agentId)!, customized: false } : a));
    st.overrides.set(workspaceId, crew);
    return ok(crew.find((a) => a.id === agentId)!);
  },

  createAgent: (input, workspaceId) => {
    const st = s();
    const agent: Agent = { id: id(), instructions: "", ...input, builtIn: false };
    if (!workspaceId) {
      st.defaults = [...st.defaults, agent];
      return ok(agent);
    }
    const w = st.workspaces.find((x) => x.id === workspaceId)!;
    const crew = [...clone(crewFor(workspaceId)), { ...agent, customized: false }];
    w.crewMode = "custom";
    st.overrides.set(workspaceId, crew);
    return ok(agent);
  },
  removeAgent: (agentId, workspaceId) => {
    const st = s();
    if (!workspaceId) st.defaults = st.defaults.filter((a) => a.id !== agentId || a.builtIn);
    else st.overrides.set(workspaceId, clone(crewFor(workspaceId)).filter((a) => a.id !== agentId || a.builtIn));
    return ok(undefined);
  },

  // The demo has no real folders: a small made-up tree.
  folders: (path) => {
    const home = "/Users/demo";
    const dev = `${home}/dev`;
    const at = path ?? home;
    const listing: FolderListing =
      at === dev
        ? {
            path: dev,
            parent: home,
            home,
            isRepo: false,
            added: false,
            entries: ["acme-web", "acme-api", "loja-ana", "blog", "side-project"].map((name) => ({
              name,
              path: `${dev}/${name}`,
              isRepo: true,
              added: s().repos.some((r) => r.name === name),
            })),
          }
        : {
            path: home,
            parent: "/Users",
            home,
            isRepo: false,
            added: false,
            entries: ["Desktop", "dev", "Documents", "Downloads"].map((name) => ({ name, path: `${home}/${name}`, isRepo: false, added: false })),
          };
    return ok(listing);
  },
  // The demo's folders are made up: "tracking" one only marks it.
  trackFolder: (path) => ok({ path }),
  teams: () => ok(s().teams),
  // The demo's "AI": a team from the request's words, after a short wait.
  proposeTeam: (input, signal) =>
    new Promise<TeamProposal>((resolve, reject) => {
      const timer = setTimeout(() => {
        const current = input.teamId ? s().teams.find((x) => x.id === input.teamId) : undefined;
        const raw = demoTeam(input.request, s().locale, current);
        const draft = normalizeTeamDraft(raw, { provider: "claude-code", providers: ["claude-code", "codex"], ...(current ? { existing: current } : {}), allowCommands: current?.commands === "standard" });
        resolve(clone({ draft: draft!, summary: raw.summary, costUsd: 0.03 }));
      }, 2600);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Stopped", "AbortError"));
      });
    }),
  applyTeamDraft: (teamId, draft) => {
    const team = s().teams.find((x) => x.id === teamId);
    if (!team) return fail("Team not found");
    const checked = normalizeTeamDraft(draft, { provider: "claude-code", providers: ["claude-code", "codex", "mock"], existing: team, allowCommands: true });
    if (!checked) return fail("A team needs at least one agent that builds.");
    const { members: _m, ...fields } = checked;
    Object.assign(team, fields, { members: draftMembers(checked) });
    return ok(team);
  },
  createTeam: (input) => {
    const st = s();
    if (input.draft) {
      const checked = normalizeTeamDraft(input.draft, { provider: "claude-code", providers: ["claude-code", "codex", "mock"], allowCommands: true });
      if (!checked) return fail("A team needs at least one agent that builds.");
      const { members: _m, ...fields } = checked;
      const team: Team = { id: id(), ...fields, name: input.name, description: input.description ?? "", members: draftMembers(checked), createdAt: iso(Date.now()) };
      st.teams.push(team);
      return ok(team);
    }
    const tpl = TEAM_TEMPLATES.find((x) => x.id === input.templateId);
    const team: Team = {
      id: id(),
      name: input.name,
      description: input.description ?? "",
      planning: tpl?.planning ?? BUILD_AND_REVIEW.id,
      kind: tpl?.kind ?? "code",
      commands: tpl?.commands ?? "standard",
      members: tpl ? templateMembers(tpl, input.locale) : clone(st.defaults).map(({ builtIn: _b, customized: _c, ...a }) => a),
      ...(tpl ? { templateId: tpl.id } : {}),
      createdAt: iso(Date.now()),
    };
    st.teams.push(team);
    return ok(team);
  },
  updateTeam: (teamId, data) => {
    const team = s().teams.find((x) => x.id === teamId);
    if (!team) return fail("Team not found");
    Object.assign(team, data);
    return ok(team);
  },
  removeTeam: (teamId) => {
    const st = s();
    st.teams = st.teams.filter((x) => x.id !== teamId);
    for (const w of st.workspaces) if (w.crewMode === "team" && w.teamId === teamId) {
      w.crewMode = "default";
      delete w.teamId;
    }
    return ok(undefined);
  },
  createTeamAgent: (teamId, input) => {
    const team = s().teams.find((x) => x.id === teamId);
    if (!team) return fail("Team not found");
    const agent: Agent = { id: id(), instructions: "", ...input };
    team.members.push(agent);
    return ok(agent);
  },
  updateTeamAgent: (teamId, agentId, data) => {
    const team = s().teams.find((x) => x.id === teamId);
    const m = team?.members.find((x) => x.id === agentId);
    if (!m) return fail("Agent not found");
    Object.assign(m, data, { role: m.role });
    return ok(m);
  },
  removeTeamAgent: (teamId, agentId) => {
    const team = s().teams.find((x) => x.id === teamId);
    if (team) team.members = team.members.filter((x) => x.id !== agentId);
    return ok(undefined);
  },
  flows: () => ok([BUILD_AND_REVIEW, LEAD_DECIDES, ...s().flows]),
  createFlow: (input) => {
    const flow: Flow = { id: id(), ...input };
    s().flows.push(flow);
    return ok(flow);
  },
  updateFlow: (flowId, input) => {
    const st = s();
    const flow = st.flows.find((f) => f.id === flowId);
    if (!flow) return fail("Built-in flows can't be changed. Duplicate it instead.");
    Object.assign(flow, input);
    return ok(flow);
  },
  removeFlow: (flowId) => {
    const st = s();
    st.flows = st.flows.filter((f) => f.id !== flowId);
    for (const w of st.workspaces) if (w.defaultFlowId === flowId) delete w.defaultFlowId;
    return ok(undefined);
  },

  rules: (scope, target) =>
    ok(s().rules.filter((r) => r.scope === scope && (scope === "global" || (scope === "workspace" ? r.workspaceId === target : r.repoId === target)))),
  addRule: (scope, target, text, source: RuleSource = "you") => {
    const rule: HouseRule = { id: id(), ...placeRule(scope, target), text, enabled: true, source, createdAt: iso(Date.now()) };
    s().rules.unshift(rule);
    return ok(rule);
  },
  updateRule: (ruleId, data) => {
    const st = s();
    const i = st.rules.findIndex((r) => r.id === ruleId);
    if (i < 0) return fail("Rule not found");
    const r = st.rules[i]!;
    st.rules[i] = {
      ...r,
      ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
      ...(data.text ? { text: data.text } : {}),
      ...(data.scope ? placeRule(data.scope, data.id ?? null) : {}),
    };
    return ok(st.rules[i]!);
  },
  removeRule: (ruleId) => {
    s().rules = s().rules.filter((r) => r.id !== ruleId);
    return ok(undefined);
  },

  tasks: () => ok([...s().tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
  task: (taskId) => {
    const task = s().tasks.find((t) => t.id === taskId);
    return task ? ok({ task, events: s().events.get(taskId) ?? [] }) : fail("Task not found");
  },
  createTask: (input: CreateTaskInput) => {
    const st = s();
    const r = st.repos.find((x) => x.id === input.repoId);
    if (!r) return fail("Repo not found");
    const task = newTask(r, input.prompt, st.locale, input.maxRounds ?? 3, iso(Date.now()));
    if (isDocsWorkspace(r.workspaceId, input.flowId)) {
      const doc = docFor(st.locale, task.title);
      task.flow = LEAD_DECIDES;
      st.tasks.unshift(task);
      st.scenarios.set(task.id, { ...simpleDoneScenario(st.locale, "", []), diff: doc.diff });
      st.diffs.set(task.id, doc.diff);
      play(task.id, docRun(task.id, task.title, doc.path));
      return ok(task);
    }
    const c = paginationScenario(st.locale);
    st.tasks.unshift(task);
    st.scenarios.set(task.id, c);
    st.diffs.set(task.id, c.diff);
    const intro = tr(st.locale, `On it: “${task.title}”. Let me look around the code first.`, `Começando: “${task.title}”. Deixa eu olhar o código primeiro.`);
    play(task.id, runSteps(task.id, c, intro));
    return ok(task);
  },
  // New documents can be previewed: their text is the added lines of the patch.
  diff: (taskId) =>
    ok(
      (s().diffs.get(taskId) ?? []).map((f) =>
        f.status === "added" && isDocument(f.path) && f.preview === undefined
          ? { ...f, preview: f.patch.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)).join("\n") }
          : f,
      ),
    ),
  answer: (taskId, text, remember, extra) => {
    const st = s();
    const task = st.tasks.find((t) => t.id === taskId);
    if (!task || task.status !== "waiting") return fail("This task isn't waiting for an answer.");
    const form = task.question?.form;
    const data = form && extra?.data && !extra.replan ? sanitizeAnswer(form, extra.data) : undefined;
    emit(taskId, { type: "answer", actor: "you", text, remember, ...(data ? { data } : {}), ...(extra?.note ? { note: extra.note } : {}), ...(extra?.replan ? { replan: true } : {}) });
    if (remember && task.question && !extra?.replan) {
      const texts = form
        ? form.fields
            .filter((f) => f.type !== "steps" && data)
            .map((f) => {
              const v = data![f.id];
              return `${f.label} → ${typeof v === "boolean" ? tr(st.locale, v ? "yes" : "no", v ? "sim" : "não") : Array.isArray(v) ? v.join(", ") : v}`;
            })
        : [`${task.question.question} → ${text}`];
      for (const t of texts) st.rules.unshift({ id: id(), ...placeRule("repo", task.repoId), text: t, enabled: true, source: "answer", createdAt: iso(Date.now()) });
    }
    node(taskId, "you", "done");
    setStatus(taskId, "running", { question: null });
    const rest = st.pending.get(taskId) ?? [];
    st.pending.delete(taskId);
    play(taskId, rest);
    return ok(st.tasks.find((t) => t.id === taskId)!);
  },
  message: (taskId, text, delivery) => {
    const st = s();
    const task = st.tasks.find((t) => t.id === taskId);
    if (!task) return fail("Task not found");
    if (task.status === "waiting") return demoApi.answer(taskId, text, false);
    if (task.status === "review") return demoApi.sendBack(taskId, text);
    if (task.status !== "running") return fail("This task has finished. Start a new one to keep going.");
    emit(taskId, { type: "message", actor: "you", text, delivery });
    if (delivery === "now") emit(taskId, { type: "steer", actor: "system" });
    setTimeout(
      () => emit(taskId, { type: "text", actor: "forge", text: tr(st.locale, `Got it: “${text}”. Taking it into account from here.`, `Entendido: “${text}”. Vou levar isso em conta daqui pra frente.`) }),
      delivery === "now" ? 900 : 2500,
    );
    return ok(task);
  },
  ackAssumptions: (taskId) => {
    if (!s().tasks.some((t) => t.id === taskId)) return fail("Task not found");
    return ok(patchTask(taskId, { assumptionsAck: true }));
  },
  sendBack: (taskId, notes) => {
    const st = s();
    const task = st.tasks.find((t) => t.id === taskId);
    if (!task || task.status !== "review") return fail("Only tasks waiting for review can be sent back.");
    const round = task.round + 1;
    emit(taskId, { type: "text", actor: "you", text: notes });
    patchTask(taskId, { round, maxRounds: Math.max(task.maxRounds, round) });
    emit(taskId, { type: "round", actor: "system", round });
    node(taskId, "you", "done");
    setStatus(taskId, "running");
    const steps = task.flow?.steps ?? [];
    if (steps[0]?.type === "lead") {
      // The last builder applies your notes, the last reviewer looks again.
      const last = (role: string) => [...steps].reverse().find((x) => x.type === "agent" && x.agentId === role);
      const w = last("writer");
      const e = last("editor");
      if (w && e) {
        const L = st.locale;
        const file = st.diffs.get(taskId)?.[0]?.path ?? "docs/faq.md";
        play(taskId, [
          ...writeSteps(taskId, w.id, "writer", tr(L, "Applying your notes.", "Aplicando suas observações."), [{ name: "Edit", input: { file_path: file }, output: "The file has been updated." }], tr(L, `Done. ${notes}`, `Pronto. ${notes}`)),
          ...editSteps(taskId, e.id, "editor", file, { approved: true, risk: "low", summary: tr(L, "Your notes are in. Ready to publish.", "Suas observações entraram. Pronto para publicar."), issues: [] }, round),
          toReview(taskId),
        ]);
        return ok(st.tasks.find((t) => t.id === taskId)!);
      }
    }
    const c = { ...st.scenarios.get(taskId)!, approveOnRound: 0 };
    play(taskId, fixSteps(taskId, c, round, notes));
    return ok(st.tasks.find((t) => t.id === taskId)!);
  },
  merge: (taskId) => {
    const task = s().tasks.find((t) => t.id === taskId);
    if (!task || task.status !== "review") return fail("Only tasks waiting for review can be merged.");
    mergeNow(taskId);
    return ok(s().tasks.find((t) => t.id === taskId)!);
  },
  discard: (taskId) => {
    stopTimers(taskId);
    setStatus(taskId, "discarded");
    return ok(s().tasks.find((t) => t.id === taskId)!);
  },
  stop: (taskId) => {
    stopTimers(taskId);
    setStatus(taskId, "cancelled");
    return ok({ ok: true });
  },
  subscribe(taskId, after, handlers) {
    const st = s();
    for (const e of (st.events.get(taskId) ?? []).filter((e) => e.seq > after)) handlers.onEvent(clone(e));
    const task = st.tasks.find((t) => t.id === taskId);
    if (task && finishedStatus(task.status)) {
      handlers.onEnd();
      return () => {};
    }
    const set = st.listeners.get(taskId) ?? new Set();
    set.add(handlers);
    st.listeners.set(taskId, set);
    return () => set.delete(handlers);
  },
};

/** What the demo's "AI" proposes: docs → Writer and Editor, data → Analyst and Checker, else a code team. */
function demoTeam(request: string, L: Locale, current?: Team): { summary: string } & Record<string, unknown> {
  const q = request.toLowerCase();
  const m = (name: string, role: string, personality: string, instructions: string, why: string) => ({ name, role, personality, instructions, why });
  if (current) {
    const security = /secur|segura/.test(q);
    const members: Record<string, unknown>[] = current.members.map((x) => ({ ...x, personality: !security && x.role === "reviewer" ? "strict" : x.personality }));
    if (security) {
      members.push(
        m(
          "Guard",
          "reviewer",
          "strict",
          tr(L, "Look for leaked secrets, unsafe input and missing auth checks. Block on any of them.", "Procure segredos expostos, entrada sem validação e falta de checagem de acesso. Bloqueie em qualquer um deles."),
          tr(L, "Nobody checked security.", "Ninguém conferia segurança."),
        ),
      );
    }
    return {
      ...current,
      members,
      summary: security ? tr(L, "Added Guard, a strict security reviewer.", "Adicionei o Guard, um revisor rígido de segurança.") : tr(L, "Made the reviewers strict.", "Deixei os revisores rígidos."),
    };
  }
  if (/doc|guia|guide|help|ajuda|manual|readme|faq/.test(q)) {
    return {
      summary: tr(L, "A small docs team: the Lead plans, Writer writes, Editor checks terms and links.", "Um time pequeno de documentação: o Lead planeja, o Writer escreve e o Editor confere termos e links."),
      name: tr(L, "Help center", "Central de ajuda"),
      description: tr(L, "Writes and checks the help center.", "Escreve e confere a central de ajuda."),
      kind: "writing",
      about: tr(L, "The product's help center, in Markdown.", "A central de ajuda do produto, em Markdown."),
      commands: "restricted",
      planning: "lead-decides",
      members: [
        m("Lead", "lead", "balanced", tr(L, "Writer writes, Editor reviews. Skip the review only for one-line fixes.", "O Writer escreve, o Editor revisa. Pule a revisão só em correções de uma linha."), tr(L, "Plans each task.", "Planeja cada tarefa.")),
        m("Writer", "builder", "mentor", tr(L, "Short sentences, one idea per paragraph, an example for each step. Keep the tone of the existing pages.", "Frases curtas, uma ideia por parágrafo, um exemplo para cada passo. Mantenha o tom das páginas que já existem."), tr(L, "Writes the pages.", "Escreve as páginas.")),
        m("Editor", "reviewer", "strict", tr(L, "Check every menu name, link and price against the app and the other pages. Block on anything wrong.", "Confira cada nome de menu, link e preço com o app e as outras páginas. Bloqueie o que estiver errado."), tr(L, "You asked for someone strict about links.", "Você pediu alguém rígido com links.")),
      ],
    };
  }
  if (/data|dados|csv|planilha|sheet|analys|anális/.test(q)) {
    return {
      summary: tr(L, "Analyst works on the data, Checker recomputes every number.", "O Analyst trabalha nos dados e o Checker recalcula cada número."),
      name: tr(L, "Data", "Dados"),
      description: tr(L, "Analyses the data and reports what it shows.", "Analisa os dados e conta o que eles mostram."),
      kind: "data",
      about: tr(L, "Spreadsheets and reports.", "Planilhas e relatórios."),
      commands: "standard",
      planning: "build-and-review",
      members: [
        m("Analyst", "builder", "balanced", tr(L, "Explain each step and never change the raw data.", "Explique cada passo e nunca altere os dados originais."), tr(L, "Does the analysis.", "Faz a análise.")),
        m("Checker", "reviewer", "strict", tr(L, "Recompute every number in the report.", "Recalcule cada número do relatório."), tr(L, "Catches wrong numbers.", "Pega números errados.")),
      ],
    };
  }
  return {
    summary: tr(L, "A Lead, a builder and a strict reviewer: small, and enough for most tasks.", "Um Lead, um construtor e um revisor rígido: pequeno, e suficiente para a maioria das tarefas."),
    name: tr(L, "Product", "Produto"),
    description: tr(L, "Builds and reviews changes to the app.", "Constrói e revisa mudanças no app."),
    kind: "code",
    about: "",
    commands: "standard",
    planning: "lead-decides",
    members: [
      m("Lead", "lead", "balanced", tr(L, "Pick the smallest team for each task.", "Escolha o menor time para cada tarefa."), tr(L, "Plans each task.", "Planeja cada tarefa.")),
      m("Builder", "builder", "balanced", tr(L, "Keep changes small and add a test for each fix.", "Mantenha as mudanças pequenas e adicione um teste para cada correção."), tr(L, "Writes the code.", "Escreve o código.")),
      m("Reviewer", "reviewer", "strict", tr(L, "Block on failing checks and real bugs.", "Bloqueie verificações falhando e bugs de verdade."), tr(L, "Keeps quality up.", "Garante a qualidade.")),
    ],
  };
}
