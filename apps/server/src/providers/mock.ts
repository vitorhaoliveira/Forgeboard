import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locale } from "@forgeboard/shared";
import { AbortedError, type AgentActivity, type Provider, type StepInput, type StepOutput } from "./types.js";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AbortedError());
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new AbortedError());
      },
      { once: true },
    );
  });
}

const t = (locale: Locale, en: string, pt: string) => (locale === "pt-BR" ? pt : en);

const DEMO_FILE = "FORGEBOARD_DEMO.md";

type Step = [delay: number, activity: AgentActivity, effect?: () => void];

/**
 * A scripted crew that needs no AI. It walks through the whole flow — a question,
 * a rejected review, a fix and an approval — and makes real file changes, so
 * merging works too. Used for UI work, tests and the public demo.
 */
export const mockProvider: Provider = {
  id: "mock",
  label: "Mock (no AI)",

  async check() {
    return { available: true, detail: "Scripted crew, no tokens used" };
  },

  async run(input: StepInput): Promise<StepOutput> {
    const { locale, cwd, round } = input;
    input.onSession?.(input.resumeSession ?? `mock-${input.role}-${round}`);
    const decide = input.prompt.includes("FORGEBOARD_ASSUMPTIONS");
    const answeringMessage = input.prompt.includes("while you worked");
    const file = join(cwd, DEMO_FILE);
    let steps: Step[];
    let text: string;

    if (input.role === "reviewer") {
      steps = [
        [500, { type: "text", text: t(locale, "Reading the diff and the check results.", "Lendo o diff e os resultados das verificações.") }],
        [700, { type: "tool_use", toolUseId: `h${round}`, name: "Read", input: { file_path: file } }],
        [600, { type: "tool_result", toolUseId: `h${round}`, output: "# Demo", isError: false }],
      ];
      const approved = round >= 2;
      const verdict = approved
        ? {
            approved: true,
            risk: "low",
            summary: t(locale, "The change is small, documented and the checks pass.", "A mudança é pequena, documentada e as verificações passam."),
            issues: [],
            suggestedRule: t(locale, "Every new file starts with a one-line description of what it is for.", "Todo arquivo novo começa com uma linha descrevendo para que serve."),
          }
        : {
            approved: false,
            risk: "medium",
            summary: t(locale, "Close, but the file is missing context.", "Quase lá, mas falta contexto no arquivo."),
            issues: [
              { severity: "high", message: t(locale, "The file doesn't explain what it is for.", "O arquivo não explica para que serve."), file: DEMO_FILE, line: 1 },
              { severity: "medium", message: t(locale, "Add a date so readers know when it was written.", "Adicione uma data para saber quando foi escrito."), file: DEMO_FILE },
            ],
          };
      text = `${verdict.summary}\n\n\`\`\`json\n${JSON.stringify(verdict, null, 2)}\n\`\`\``;
    } else if (round === 1 && !input.resumeSession && !decide) {
      // First step of Forge: explore, then ask a question.
      steps = [
        [500, { type: "text", text: t(locale, "Let me look at the project first.", "Deixa eu olhar o projeto primeiro.") }],
        [600, { type: "tool_use", toolUseId: "f1", name: "Glob", input: { pattern: "**/*.md" } }],
        [600, { type: "tool_result", toolUseId: "f1", output: "README.md", isError: false }],
        [500, { type: "tool_use", toolUseId: "f2", name: "Read", input: { file_path: join(cwd, "README.md") } }],
        [700, { type: "tool_result", toolUseId: "f2", output: "# Project", isError: false }],
      ];
      // Ask with a form: one decision plus a short plan to approve. A2UI renders it in the browser.
      const form = {
        kind: "plan",
        title: t(locale, "Before I start: one decision and the plan", "Antes de começar: uma decisão e o plano"),
        context: t(locale, "The README is already long. A separate file keeps it focused.", "O README já está longo. Um arquivo separado deixa ele mais focado."),
        fields: [
          { id: "place", type: "choice", label: t(locale, "Where should the notes go?", "Onde as notas devem ficar?"), options: [t(locale, "Separate file", "Arquivo separado"), t(locale, "In the README", "No README")], suggested: 0 },
          { id: "date", type: "toggle", label: t(locale, "Add today's date?", "Adicionar a data de hoje?"), value: true },
          {
            id: "plan",
            type: "steps",
            label: t(locale, "Plan", "Plano"),
            value: [
              { text: t(locale, "Create the notes file", "Criar o arquivo de notas"), estimate: "~1 min" },
              { text: t(locale, "Write a short description", "Escrever uma descrição curta"), estimate: "~1 min" },
              { text: t(locale, "Link it from the README", "Linkar a partir do README"), estimate: "~1 min" },
            ],
          },
        ],
      };
      text = input.prompt.includes('"kind": "plan"')
        ? `${t(locale, "I need your input before I continue.", "Preciso da sua opinião antes de continuar.")}\nFORGEBOARD_FORM: ${JSON.stringify(form)}`
        : // Plans turned off in this workspace: a plain question.
          `${t(locale, "One decision before I continue.", "Uma decisão antes de continuar.")}\nFORGEBOARD_QUESTION: ${JSON.stringify({
            question: form.fields[0]!.label,
            context: form.context,
            options: form.fields[0]!.options,
            suggested: 0,
          })}`;
    } else if (round === 1) {
      steps = [
        [500, { type: "text", text: t(locale, "Got it. Creating the file now.", "Entendido. Criando o arquivo agora.") }],
        [600, { type: "tool_use", toolUseId: "f3", name: "Write", input: { file_path: file } }, () => writeFileSync(file, `# Demo\n\n${t(locale, "Project notes written by the crew.", "Notas do projeto escritas pela equipe.")}\n`)],
        [500, { type: "tool_result", toolUseId: "f3", output: "File created.", isError: false }],
      ];
      text = t(locale, `Created \`${DEMO_FILE}\` with the requested notes.`, `Criei o \`${DEMO_FILE}\` com as notas pedidas.`);
      if (answeringMessage) steps.unshift([400, { type: "text", text: t(locale, "Got your message. Adjusting.", "Recebi sua mensagem. Ajustando.") }]);
      if (decide) {
        const assumptions = [
          t(locale, "Put the notes in a separate file, to keep the README short", "Coloquei as notas num arquivo separado, para o README continuar curto"),
          t(locale, "Added today's date at the top", "Adicionei a data de hoje no topo"),
        ];
        text += `\nFORGEBOARD_ASSUMPTIONS: ${JSON.stringify(assumptions)}`;
      }
    } else {
      steps = [
        [500, { type: "text", text: t(locale, "Fixing what Hawk pointed out.", "Corrigindo o que o Hawk apontou.") }],
        [
          600,
          { type: "tool_use", toolUseId: `f${round}e`, name: "Edit", input: { file_path: file } },
          () => {
            if (!existsSync(file)) writeFileSync(file, "# Demo\n");
            appendFileSync(file, `\n> ${t(locale, "Notes kept by the crew", "Notas mantidas pela equipe")} · ${new Date().toISOString().slice(0, 10)}\n`);
          },
        ],
        [500, { type: "tool_result", toolUseId: `f${round}e`, output: "The file has been updated.", isError: false }],
      ];
      text = t(locale, "Added a description and a date to the file.", "Adicionei uma descrição e uma data ao arquivo.");
    }

    const started = Date.now();
    for (const [delay, activity, effect] of steps) {
      await sleep(delay, input.signal);
      effect?.();
      input.emit(activity);
    }
    await sleep(400, input.signal);
    return { sessionId: `mock-${input.role}-${round}`, text, costUsd: 0, durationMs: Date.now() - started };
  },
};
