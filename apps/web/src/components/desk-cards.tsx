"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useState, type FormEvent, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { GitMerge, Loader2 } from "lucide-react";
import type { FormAnswer, Task } from "@forgeboard/shared";
import { summarizeAnswer } from "@forgeboard/shared/a2ui";
import { api } from "@/lib/api";
import { stepGlyph } from "@/lib/flow-view";
import { PlanSteps } from "./activity-feed";
import { useTaskAgents } from "@/lib/use-task-agents";
import { useAcceptWords, useAppState, WorkspaceScope } from "@/lib/app-state";
import { cn, formatCost, timeAgo } from "@/lib/utils";
import { Glyph } from "./glyph";
import { StatusDot } from "./status-chip";
import { Button, buttonClass, Chip } from "./ui";

// A2UI renders in the browser only.
const AgentFormView = dynamic(() => import("./agent-form"), {
  ssr: false,
  loading: () => <div className="h-24 animate-pulse rounded-xl bg-panel-2" />,
});

/** Answer an agent's question in one click, or in your own words. */
export function QuestionCard({ task, compact, showRepo }: { task: Task; compact?: boolean; showRepo?: boolean }) {
  const t = useTranslations("question");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const { agentName, refreshTasks, repo } = useAppState();
  const { builder } = useTaskAgents(task);
  const gate = Boolean(task.question?.gate);
  const planApproval = Boolean(task.question?.planApproval);
  const asker = task.question?.askedBy ?? builder;
  const [custom, setCustom] = useState(false);
  const [text, setText] = useState("");
  // Off by default: most answers are about this task only. Tick it for real conventions.
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const tf = useTranslations("form");
  const q = task.question;
  const form = q?.form && q.ui ? q.form : null;
  const isPlan = form?.kind === "plan";

  const footer = useCallback(
    (primary: ReactNode) =>
      isPlan ? (
        <div className="flex flex-wrap items-center gap-2.5">
          <label htmlFor={`note-${task.id}`} className="sr-only">
            {tf("noteLabel", { name: agentName(asker, task.workspaceId) })}
          </label>
          <input
            id={`note-${task.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={tf("notePlaceholder", { name: agentName(asker, task.workspaceId) })}
            className="h-9 min-w-0 flex-[1_1_260px] rounded-lg border border-border bg-bg px-3 text-[13px] outline-none focus:border-border-strong"
          />
          <Button className="h-9" disabled={busy} onClick={() => void answer(tf("replanText"), { replan: true, note: note.trim() || undefined })}>
            {tf("replan")}
          </Button>
          {primary}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2.5">
          {primary}
          {!custom && (
            <Button className="h-9" onClick={() => setCustom(true)} disabled={busy}>
              {t("ownWords")}
            </Button>
          )}
          <label className="ml-auto inline-flex items-center gap-2 text-[12.5px] text-muted">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-accent" />
            {tf("rememberMany")}
          </label>
        </div>
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isPlan, note, busy, custom, remember, task.id, task.workspaceId],
  );

  if (!q) return null;

  function submitForm(data: FormAnswer) {
    if (!form) return;
    const summary = summarizeAnswer(form, data, tf("yes"), tf("no"));
    const plan = form.fields.find((f) => f.type === "steps");
    const count = plan ? ((data[plan.id] as { included?: boolean }[] | undefined) ?? []).filter((s) => s.included !== false).length : 0;
    const text = isPlan ? tf("planApproved", { count }) : summary;
    void answer(text, { data, note: note.trim() || undefined });
  }

  async function answer(value: string, extra?: { data?: FormAnswer; note?: string; replan?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      await api.answer(task.id, value, isPlan ? false : remember, extra);
      void refreshTasks();
      router.push(`/runs/${task.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  function submitCustom(e: FormEvent) {
    e.preventDefault();
    if (text.trim()) void answer(text.trim());
  }

  return (
    <WorkspaceScope workspaceId={task.workspaceId}>
    <article className="flex flex-col gap-3 rounded-2xl border border-accent/50 bg-panel p-[18px] shadow-[0_0_0_4px_rgba(249,115,22,.06)]">
      <div className="flex flex-wrap items-center gap-2.5">
        <Glyph actor={gate ? "you" : asker} />
        <span className="text-xs font-medium text-accent">
          {planApproval
            ? t("planTitle", { name: agentName(asker, task.workspaceId) })
            : gate
            ? t("gateTitle")
            : form
              ? isPlan
                ? tf("planTitle", { name: agentName(asker, task.workspaceId) })
                : tf("formTitle", { name: agentName(asker, task.workspaceId), count: form.fields.length })
              : t("title", { name: agentName(asker, task.workspaceId) })}
        </span>
        {showRepo && <Chip className="h-[22px] font-mono">{repo(task.repoId)?.name ?? "—"}</Chip>}
        {!compact && (
          <>
            <span className="text-[12.5px] text-muted">
              · <Link href={`/runs/${task.id}`} className="hover:text-text">{task.title}</Link> · {t("waiting", { time: timeAgo(task.updatedAt, locale) })}
            </span>
            <Link href={`/runs/${task.id}?reply=1`} className="ml-auto text-[12.5px] text-muted hover:text-text">
              {t("openConversation")} →
            </Link>
          </>
        )}
      </div>
      <h2 className="text-base font-semibold">{q.question}</h2>
      {form && compact ? (
        <div className="pt-2">
          <AgentFormView form={form} ui={q.ui!} busy={busy} onSubmit={submitForm} footer={footer} />
        </div>
      ) : form ? (
        <>
          {q.context && <p className="text-[13.5px] text-muted">{q.context}</p>}
          <div>
            <Link href={`/runs/${task.id}`} className={buttonClass("primary")}>
              {isPlan ? t("seePlan") : t("answerForm", { count: form.fields.length })}
            </Link>
          </div>
        </>
      ) : (
        <>
          {q.context && <p className="text-[13.5px] text-muted">{q.context}</p>}
          {planApproval && task.flow && (
            <div className="rounded-[10px] border border-border bg-bg px-3 py-2.5 text-[13px]">
              <PlanSteps steps={task.flow.steps} reasons={task.plan?.reasons ?? {}} />
            </div>
          )}
          <form onSubmit={submitCustom} className="flex gap-2">
            <label htmlFor={`answer-${task.id}`} className="sr-only">
              {t("placeholder")}
            </label>
            <input
              id={`answer-${task.id}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("placeholder")}
              className="h-9 min-w-0 grow rounded-[9px] border border-border-strong bg-bg px-3 text-[13.5px] outline-none focus:border-text/30"
            />
            <Button type="submit" variant="primary" className="h-9" disabled={!text.trim() || busy}>
              {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
              {tc("send")}
            </Button>
          </form>
          <div className="flex flex-wrap items-center gap-1.5">
            {q.options.map((option, i) => (
              <button
                key={option}
                type="button"
                disabled={busy}
                onClick={() => answer(option)}
                className={cn(
                  "inline-flex h-7 items-center rounded-full border px-2.5 text-[12.5px] transition disabled:opacity-50",
                  i === q.suggested ? "border-accent/45 bg-accent/[0.07] text-[#fdba74]" : "border-border bg-panel-2 hover:border-border-strong",
                )}
              >
                {option}
              </button>
            ))}
            {!gate && !planApproval && (
              <label className="ml-auto inline-flex items-center gap-2 text-[12px] text-muted">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-accent" />
                {t("remember")}
              </label>
            )}
          </div>
        </>
      )}
      {custom && form && compact && (
        <form onSubmit={submitCustom} className="flex gap-2">
          <label htmlFor={`answer-${task.id}`} className="sr-only">
            {t("placeholder")}
          </label>
          <input
            id={`answer-${task.id}`}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("placeholder")}
            className="h-[34px] min-w-0 grow rounded-lg border border-border bg-bg px-3 outline-none focus:border-border-strong"
          />
          <Button type="submit" variant="primary" disabled={!text.trim() || busy}>
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
            {tc("send")}
          </Button>
        </form>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </article>
    </WorkspaceScope>
  );
}

/** Work that is done: merge straight away or look closer. */
export function ReviewCard({ task, showRepo }: { task: Task; showRepo?: boolean }) {
  const t = useTranslations("review");
  const { agentName, refreshTasks, repo } = useAppState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = task.verdict;
  const { reviewer: lastReviewer } = useTaskAgents(task);
  const reviewer = v?.by ?? lastReviewer;
  const checks = task.checks ?? [];
  const passed = checks.filter((c) => c.ok).length;
  const approved = Boolean(v?.approved);
  const accept = useAcceptWords(task.workspaceId);

  async function merge() {
    setBusy(true);
    setError(null);
    try {
      await api.merge(task.id);
      await refreshTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <WorkspaceScope workspaceId={task.workspaceId}>
    <article className="flex flex-col gap-3 rounded-2xl border border-border bg-panel p-[18px]">
      <div className="flex flex-wrap items-center gap-2.5">
        <Glyph actor={reviewer} />
        <span className={cn("text-xs font-medium", approved ? "text-success" : "text-warning")}>
          {approved ? t(accept ? "readyAccept" : "ready") : t("concerns")}
        </span>
        {showRepo && <Chip className="h-[22px] font-mono">{repo(task.repoId)?.name ?? "—"}</Chip>}
        <span className="text-[12.5px] text-muted">
          · {t(approved ? "approvedBy" : "notApproved", { name: agentName(reviewer, task.workspaceId), count: task.round })}
        </span>
        {v && (
          <Chip className="ml-auto" tone={v.risk === "low" ? "success" : v.risk === "high" ? "danger" : "warning"}>
            {t("risk", { level: v.risk })}
          </Chip>
        )}
      </div>
      <h2 className="text-[17px] font-semibold">{task.title}</h2>
      {v?.summary && <p className="text-[13.5px] text-muted">{v.summary}</p>}
      <div className="flex flex-wrap gap-1.5">
        {checks.length > 0 && (
          <Chip tone={passed === checks.length ? "success" : "danger"}>{t("checksPassed", { passed, total: checks.length })}</Chip>
        )}
        {checks.map((c) => (
          <Chip key={c.name} className="font-mono">
            <span className={c.ok ? "text-success" : "text-danger"}>{c.ok ? "✓" : "✕"}</span>
            {c.name}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {approved && (
          <Button variant="primary" onClick={merge} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <GitMerge className="size-3.5" aria-hidden="true" />}
            {accept ? t("mergeAccept") : t("merge", { branch: task.baseBranch ?? "main" })}
          </Button>
        )}
        <Link href={`/runs/${task.id}/decide`} className={buttonClass(approved ? "secondary" : "primary")}>
          {t("lookCloser")}
        </Link>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </article>
    </WorkspaceScope>
  );
}

export function WorkingCard({ task }: { task: Task }) {
  const tc = useTranslations("common");
  const ts = useTranslations("status");
  const locale = useLocale();
  const { flow } = useTaskAgents(task);
  return (
    <Link href={`/runs/${task.id}`} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-panel p-3.5 hover:border-border-strong">
      <span className="flex items-center gap-2">
        <span className="min-w-0 truncate font-medium">{task.title}</span>
        <span className="ml-auto shrink-0 font-mono text-xs text-muted">{timeAgo(task.createdAt, locale)}</span>
      </span>
      <span className="flex items-center gap-0">
        {flow.steps.map((step, i) => (
          <Fragment key={step.id}>
            {i > 0 && <span className="h-0.5 w-3.5 bg-border-strong" />}
            <Glyph actor={stepGlyph(step)} size={22} />
          </Fragment>
        ))}
        <span className="ml-2.5 text-xs text-info">{task.round > 0 ? tc("round", { round: task.round, max: task.maxRounds }) : ts("queued")}</span>
      </span>
    </Link>
  );
}

export function RecentRow({ task }: { task: Task }) {
  const locale = useLocale();
  return (
    <Link href={`/runs/${task.id}`} className="flex items-center gap-2.5 py-2.5 text-[13px] hover:text-text">
      <StatusDot status={task.status} />
      <span className="min-w-0 truncate">{task.title}</span>
      <span className="ml-auto shrink-0 text-[12.5px] text-muted">{timeAgo(task.finishedAt ?? task.updatedAt, locale)}</span>
      <span className="w-16 shrink-0 text-right font-mono text-xs text-muted">{formatCost(task.costUsd, locale)}</span>
    </Link>
  );
}

/** Tasks with decisions a builder made on its own that you haven't looked at yet. */
export function toCheck(tasks: Task[]): Task[] {
  return tasks.filter((x) => (x.assumptions?.length ?? 0) > 0 && !x.assumptionsAck && x.status !== "discarded" && x.status !== "cancelled");
}

/** "I decided N things for you": doesn't block the task; look, then confirm or correct. */
export function AssumptionsCard({ task, showRepo }: { task: Task; showRepo?: boolean }) {
  const t = useTranslations("question");
  const { agentName, refreshTasks, repo } = useAppState();
  const { builder } = useTaskAgents(task);
  const [busy, setBusy] = useState(false);
  const items = task.assumptions ?? [];

  async function ack() {
    setBusy(true);
    await api.ackAssumptions(task.id).catch(() => undefined);
    await refreshTasks();
    setBusy(false);
  }

  return (
    <WorkspaceScope workspaceId={task.workspaceId}>
      <article className="flex flex-col gap-2.5 rounded-2xl border border-border bg-panel p-4">
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          <Glyph actor={builder} />
          <span className="font-medium text-accent">{agentName(builder, task.workspaceId)}</span>
          {showRepo && <Chip className="h-[22px] font-mono">{repo(task.repoId)?.name ?? "—"}</Chip>}
          <Link href={`/runs/${task.id}`} className="hover:text-text">
            {task.title}
          </Link>
          {task.status === "running" && <span className="text-info">· {t("stillWorking")}</span>}
        </div>
        <h3 className="text-[15px] font-medium">{t("decidedCount", { count: items.length })}</h3>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px]">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button onClick={ack} disabled={busy}>
            {t("looksGood")}
          </Button>
          <Link href={`/runs/${task.id}?reply=1`} className={buttonClass("secondary")}>
            {t("correct")}
          </Link>
        </div>
      </article>
    </WorkspaceScope>
  );
}
