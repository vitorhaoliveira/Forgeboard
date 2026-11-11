"use client";

import { Fragment, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Check, Copy, Loader2, MessageCircleQuestion, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  BUILD_AND_REVIEW,
  LEAD_DECIDES_ID,
  MAX_FLOW_ROUNDS,
  MAX_FLOW_STEPS,
  validateFlow,
  type Flow,
  type FlowInput,
  type FlowProblem,
  type FlowStep,
} from "@forgeboard/shared";
import { api } from "@/lib/api";
import { useAppState } from "@/lib/app-state";
import { roleOfIn, sendBackIndex, stepGlyph } from "@/lib/flow-view";
import { idleStates } from "@/lib/run-model";
import { cn } from "@/lib/utils";
import { FlowGraph, useFlowName } from "./flow-graph";
import { Glyph, useActorName } from "./glyph";
import { Button, Chip, SectionLabel } from "./ui";

const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 7)}`;

/** A copy of a flow with fresh step ids, keeping "send back to" links. */
function copySteps(steps: FlowStep[]): FlowStep[] {
  const ids = new Map(steps.map((s) => [s.id, newId(s.type === "agent" ? s.agentId : s.type)]));
  return steps.map((s) => (s.type === "agent" ? { ...s, id: ids.get(s.id)!, ...(s.sendBackTo ? { sendBackTo: ids.get(s.sendBackTo) } : {}) } : { ...s, id: ids.get(s.id)! }));
}

/** The text for a problem that stops a flow from running. */
function useProblemText() {
  const t = useTranslations("flows");
  const name = useActorName();
  return (p: FlowProblem, steps: FlowStep[]) => {
    const position = "step" in p ? steps.findIndex((s) => s.id === p.step) + 1 : 0;
    switch (p.code) {
      case "unknownAgent":
        return t("problem.unknownAgent", { position, name: name(p.agentId) });
      case "tooMany":
      case "rounds":
        return t(`problem.${p.code}`, { max: p.max, position });
      default:
        return t(`problem.${p.code}`, { position });
    }
  };
}

/** One flow in the list: its steps as glyphs, and what you can do with it. */
function FlowRow({ flow, onEdit, onDuplicate }: { flow: Flow; onEdit: () => void; onDuplicate: () => void }) {
  const t = useTranslations("flows");
  const tc = useTranslations("common");
  const flowName = useFlowName();
  const { refreshFlows, refreshWorkspaces, workspaces } = useAppState();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usedBy = workspaces.filter((w) => w.defaultFlowId === flow.id).length;

  async function remove() {
    try {
      await api.removeFlow(flow.id);
      await Promise.all([refreshFlows(), refreshWorkspaces()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-border bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">{flowName(flow)}</h2>
        {flow.builtIn && <Chip>{t("builtIn")}</Chip>}
        {usedBy > 0 && <Chip tone="info">{t("defaultIn", { count: usedBy })}</Chip>}
        <span className="ml-auto flex gap-1.5">
          {!flow.builtIn && (
            <Button variant="ghost" onClick={onEdit}>
              <Pencil className="size-3.5" aria-hidden="true" />
              {t("edit")}
            </Button>
          )}
          <Button variant="ghost" onClick={onDuplicate}>
            <Copy className="size-3.5" aria-hidden="true" />
            {t("duplicate")}
          </Button>
          {!flow.builtIn &&
            (confirm ? (
              <>
                <Button variant="ghost" onClick={() => setConfirm(false)}>
                  {tc("cancel")}
                </Button>
                <Button variant="danger" onClick={remove}>
                  {t("confirmDelete")}
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirm(true)} className="hover:text-danger">
                <Trash2 className="size-3.5" aria-hidden="true" />
                {tc("delete")}
              </Button>
            ))}
        </span>
      </div>
      {(flow.builtIn || flow.description) && (
        <p className="text-[13px] text-muted">
          {!flow.builtIn ? flow.description : flow.id === LEAD_DECIDES_ID ? t("leadDescription") : t("builtInDescription")}
        </p>
      )}
      <StepChain steps={flow.steps} />
      {error && <p className="text-xs text-danger">{error}</p>}
    </article>
  );
}

/** A flow's steps as a row of glyphs. */
function StepChain({ steps }: { steps: FlowStep[] }) {
  return (
    <span className="flex flex-wrap items-center gap-0">
      {steps.map((step, i) => (
        <Fragment key={step.id}>
          {i > 0 && <span className="h-0.5 w-3.5 bg-border-strong" />}
          <Glyph actor={stepGlyph(step)} size={22} />
        </Fragment>
      ))}
    </span>
  );
}

/** Edits a flow as a list of steps, with a live preview of the graph. */
function FlowEditor({ initial, flowId, onDone }: { initial: FlowInput; flowId: string | null; onDone: () => void }) {
  const t = useTranslations("flows");
  const tc = useTranslations("common");
  const name = useActorName();
  const problemText = useProblemText();
  const { crews, refreshFlows } = useAppState();
  const crew = useMemo(() => crews.default ?? [], [crews]);
  const roleOf = useMemo(() => roleOfIn(crew), [crew]);
  const strictRole = (id: string) => crew.find((a) => a.id === id)?.role;
  const [draft, setDraft] = useState<FlowInput>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problems = validateFlow(draft, strictRole);
  const steps = draft.steps;

  const setSteps = (next: FlowStep[]) => setDraft({ ...draft, steps: next });
  const update = (i: number, patch: Partial<FlowStep>) => setSteps(steps.map((s, j) => (j === i ? ({ ...s, ...patch } as FlowStep) : s)));
  const move = (i: number, by: number) => {
    const next = [...steps];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s!);
    setSteps(next);
  };
  const remove = (i: number) => {
    const gone = steps[i]!.id;
    // Reviewers that sent work to the removed step go back to "the builder before".
    setSteps(steps.filter((_, j) => j !== i).map((s) => (s.type === "agent" && s.sendBackTo === gone ? { ...s, sendBackTo: undefined } : s)));
  };
  const add = (step: FlowStep) => setSteps([...steps, step]);
  // A lead plans the rest: a flow with a lead step has no other steps.
  const hasLead = steps.some((s) => s.type === "lead");
  const firstOf = (role: "builder" | "reviewer") => crew.find((a) => a.role === role)?.id ?? crew[0]?.id ?? "forge";

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const input = { ...draft, name: draft.name.trim(), description: draft.description.trim() };
      if (flowId) await api.updateFlow(flowId, input);
      else await api.createFlow(input);
      await refreshFlows();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const preview: Flow = { id: "preview", ...draft };
  return (
    <article className="flex flex-col gap-5 rounded-2xl border border-border-strong bg-panel p-5">
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <label className="flex flex-col gap-1.5">
          <SectionLabel>{t("name").toUpperCase()}</SectionLabel>
          <input
            value={draft.name}
            maxLength={40}
            autoFocus
            placeholder={t("namePlaceholder")}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="h-[34px] rounded-lg border border-border bg-bg px-2.5 text-[13px] outline-none focus:border-border-strong"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <SectionLabel>{t("description").toUpperCase()}</SectionLabel>
          <input
            value={draft.description}
            maxLength={200}
            placeholder={t("descriptionPlaceholder")}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            className="h-[34px] rounded-lg border border-border bg-bg px-2.5 text-[13px] outline-none focus:border-border-strong"
          />
        </label>
      </div>

      <section className="dot-grid overflow-x-auto rounded-xl border border-border px-4 py-6" aria-label={t("preview")}>
        {steps.length > 0 ? (
          <FlowGraph flow={preview} roleOf={roleOf} states={{ ...idleStates(preview), task: "done" }} />
        ) : (
          <p className="text-center text-[13px] text-muted">{t("noSteps")}</p>
        )}
      </section>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("steps").toUpperCase()}</SectionLabel>
        <ol className="flex flex-col gap-2">
          {steps.map((step, i) => {
            const role = step.type === "agent" ? roleOf(step.agentId) : null;
            const builders = steps.slice(0, i).filter((s) => s.type === "agent" && roleOf(s.agentId) === "builder");
            // What "the builder before" means for this step, ignoring a target picked by hand.
            const autoTarget = sendBackIndex({ ...draft, steps: steps.map((s, j) => (j === i && s.type === "agent" ? { ...s, sendBackTo: undefined } : s)) } as Flow, i, roleOf);
            return (
              <li key={step.id} className="flex flex-wrap items-center gap-2.5 rounded-xl border border-border bg-bg px-3 py-2.5">
                <span className="w-5 shrink-0 text-center font-mono text-xs text-muted">{i + 1}</span>
                {step.type === "agent" ? (
                  <>
                    <Glyph actor={step.agentId} size={24} />
                    <select
                      aria-label={t("agent")}
                      value={step.agentId}
                      onChange={(e) => update(i, { agentId: e.target.value, sendBackTo: undefined, maxRounds: undefined } as Partial<FlowStep>)}
                      className="h-8 rounded-lg border border-border bg-panel-2 px-2 text-[13px] outline-none"
                    >
                      {!crew.some((a) => a.id === step.agentId) && <option value={step.agentId}>{name(step.agentId)}</option>}
                      {crew.filter((a) => a.role !== "lead").map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} · {a.role === "builder" ? t("builds") : t("reviews")}
                        </option>
                      ))}
                    </select>
                    {role === "reviewer" && (
                      <>
                        <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
                          {t("sendBackTo")}
                          <select
                            value={step.sendBackTo ?? ""}
                            onChange={(e) => update(i, { sendBackTo: e.target.value || undefined } as Partial<FlowStep>)}
                            className="h-8 rounded-lg border border-border bg-panel-2 px-2 text-[13px] text-text outline-none"
                          >
                            <option value="">
                              {autoTarget !== -1 && steps[autoTarget]?.type === "agent"
                                ? t("builderBefore", { name: name((steps[autoTarget] as Extract<FlowStep, { type: "agent" }>).agentId) })
                                : t("nobody")}
                            </option>
                            {builders.map((b) => (
                              <option key={b.id} value={b.id}>
                                {steps.indexOf(b) + 1}. {b.type === "agent" ? name(b.agentId) : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
                          {t("rounds")}
                          <select
                            value={step.maxRounds ?? ""}
                            onChange={(e) => update(i, { maxRounds: e.target.value ? Number(e.target.value) : undefined } as Partial<FlowStep>)}
                            className="h-8 rounded-lg border border-border bg-panel-2 px-2 text-[13px] text-text outline-none"
                          >
                            <option value="">{t("roundsDefault")}</option>
                            {Array.from({ length: MAX_FLOW_ROUNDS }, (_, n) => n + 1).map((n) => (
                              <option key={n} value={n}>
                                {n}×
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                  </>
                ) : step.type === "lead" ? (
                  <>
                    <Glyph actor={step.agentId} size={24} />
                    <span className="text-[13px]">{name(step.agentId)}</span>
                    <span className="text-[12.5px] text-muted">{t("leadHint")}</span>
                  </>
                ) : step.type === "checks" ? (
                  <>
                    <Glyph actor="checks" size={24} />
                    <span className="text-[13px]">{t("checks")}</span>
                    <span className="text-[12.5px] text-muted">{t("checksHint")}</span>
                  </>
                ) : step.type === "ask" ? (
                  <>
                    <span className="grid size-6 place-items-center rounded-lg border border-border bg-panel-2 text-violet">
                      <MessageCircleQuestion className="size-3.5" aria-hidden="true" />
                    </span>
                    <span className="text-[13px]">{t("ask")}</span>
                    <input
                      aria-label={t("askNote")}
                      value={step.note ?? ""}
                      maxLength={300}
                      placeholder={t("askPlaceholder")}
                      onChange={(e) => update(i, { note: e.target.value || undefined } as Partial<FlowStep>)}
                      className="h-8 min-w-[200px] grow rounded-lg border border-border bg-panel-2 px-2 text-[13px] outline-none"
                    />
                  </>
                ) : null}
                <span className="ml-auto flex gap-0.5">
                  <Button variant="ghost" aria-label={t("moveUp")} onClick={() => move(i, -1)} disabled={i === 0} className="px-1.5">
                    <ArrowUp className="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" aria-label={t("moveDown")} onClick={() => move(i, 1)} disabled={i === steps.length - 1} className="px-1.5">
                    <ArrowDown className="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" aria-label={t("removeStep")} onClick={() => remove(i)} className="px-1.5 hover:text-danger">
                    <X className="size-3.5" aria-hidden="true" />
                  </Button>
                </span>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => add({ id: newId("builder"), type: "agent", agentId: firstOf("builder") })} disabled={steps.length >= MAX_FLOW_STEPS || hasLead}>
            <Plus className="size-3.5" aria-hidden="true" />
            {t("addBuilder")}
          </Button>
          <Button onClick={() => add({ id: newId("reviewer"), type: "agent", agentId: firstOf("reviewer") })} disabled={steps.length >= MAX_FLOW_STEPS || hasLead}>
            <Plus className="size-3.5" aria-hidden="true" />
            {t("addReviewer")}
          </Button>
          <Button onClick={() => add({ id: newId("checks"), type: "checks" })} disabled={steps.length >= MAX_FLOW_STEPS || hasLead}>
            <Plus className="size-3.5" aria-hidden="true" />
            {t("addChecks")}
          </Button>
          <Button onClick={() => add({ id: newId("ask"), type: "ask" })} disabled={steps.length >= MAX_FLOW_STEPS || hasLead}>
            <Plus className="size-3.5" aria-hidden="true" />
            {t("addAsk")}
          </Button>
        </div>
        <p className="text-[12.5px] text-muted">{t("endsWithYou")}</p>
      </div>

      {problems.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[12.5px] text-warning">
          {problems.map((p, i) => (
            <li key={i}>{problemText(p, steps)}</li>
          ))}
        </ul>
      )}
      <p className="text-[12.5px] text-muted">{t("crewNote")}</p>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={busy}>
          {tc("cancel")}
        </Button>
        <Button variant="primary" onClick={save} disabled={busy || problems.length > 0}>
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
          {flowId ? tc("save") : t("create")}
        </Button>
      </div>
    </article>
  );
}

/** The flows page: the flows you can run, and the editor. */
export function FlowsView() {
  const t = useTranslations("flows");
  const flowName = useFlowName();
  const { flows } = useAppState();
  const [editing, setEditing] = useState<{ flowId: string | null; initial: FlowInput } | null>(null);

  const startNew = () =>
    setEditing({ flowId: null, initial: { name: "", description: "", steps: copySteps(BUILD_AND_REVIEW.steps) } });
  const duplicate = (flow: Flow) =>
    setEditing({ flowId: null, initial: { name: t("copyOf", { name: flowName(flow) }).slice(0, 40), description: flow.builtIn ? "" : flow.description, steps: copySteps(flow.steps) } });
  const edit = (flow: Flow) => setEditing({ flowId: flow.id, initial: { name: flow.name, description: flow.description, steps: flow.steps } });

  return (
    <main className="flex justify-center px-8 py-7">
      <div className="flex w-full max-w-[1080px] flex-col gap-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <h1 className="text-[22px] font-semibold">{t("title")}</h1>
            <p className="mt-1 max-w-2xl text-[13.5px] text-muted">{t("body")}</p>
          </div>
          {!editing && (
            <Button variant="primary" onClick={startNew} className="ml-auto">
              <Plus className="size-3.5" aria-hidden="true" />
              {t("newFlow")}
            </Button>
          )}
        </div>
        {editing && <FlowEditor key={editing.flowId ?? "new"} initial={editing.initial} flowId={editing.flowId} onDone={() => setEditing(null)} />}
        <div className={cn("flex flex-col gap-3", editing && "opacity-60")}>
          {flows.map((flow) => (
            <FlowRow key={flow.id} flow={flow} onEdit={() => edit(flow)} onDuplicate={() => duplicate(flow)} />
          ))}
        </div>
      </div>
    </main>
  );
}
