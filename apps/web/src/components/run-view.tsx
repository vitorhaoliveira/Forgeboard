"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { GitBranch, Loader2, Play, Square, Trash2 } from "lucide-react";
import { isActive, isFinished, type Actor, type FlowNode, type RunEvent } from "@forgeboard/shared";
import { api } from "@/lib/api";
import { useAppState, WorkspaceScope } from "@/lib/app-state";
import { lastHandBack, nodeStates, runBounds, segments } from "@/lib/run-model";
import { useTaskStream } from "@/lib/use-task-stream";
import { cn, formatCost, timeAgo } from "@/lib/utils";
import { ActivityFeed } from "./activity-feed";
import { QuestionCard } from "./desk-cards";
import { FlowGraph } from "./flow-graph";
import { Glyph, useActorName } from "./glyph";
import { RunTimeline } from "./run-timeline";
import { StatusChip } from "./status-chip";
import { Button, buttonClass } from "./ui";
import { WorkspaceDot } from "./workspace-ui";

const FILTERS: (Actor | null)[] = [null, "forge", "checks", "hawk", "you"];

/** Short live notes under graph nodes. */
function graphNotes(events: RunEvent[], t: (k: string, v?: Record<string, string | number>) => string): Partial<Record<FlowNode, string>> {
  const notes: Partial<Record<FlowNode, string>> = {};
  for (const e of events) {
    if (e.type === "tool_use" && e.actor === "forge") notes.forge = e.name;
    if (e.type === "checks") {
      const failed = e.results.filter((r) => !r.ok).length;
      notes.checks = e.results.length === 0 ? "—" : failed ? t("checksFailed", { count: failed }) : t("checksAllPassed");
    }
    if (e.type === "verdict") notes.hawk = e.verdict.approved ? t("approved") : t("changesRequested");
  }
  return notes;
}

export function RunView({ taskId }: { taskId: string }) {
  const t = useTranslations("run");
  const tf = useTranslations("flow");
  const td = useTranslations("decide");
  const locale = useLocale();
  const router = useRouter();
  const name = useActorName();
  const { refreshTasks, workspace, repo } = useAppState();
  const { task, events: allEvents, error } = useTaskStream(taskId);
  /** While replaying, how many events are shown. */
  const [replayAt, setReplayAt] = useState<number | null>(null);
  const events = useMemo(() => (replayAt === null ? allEvents : allEvents.slice(0, replayAt)), [allEvents, replayAt]);

  useEffect(() => {
    if (replayAt === null) return;
    if (replayAt >= allEvents.length) {
      const done = setTimeout(() => setReplayAt(null), 1200);
      return () => clearTimeout(done);
    }
    // Follow the original rhythm, ten times faster, within sensible bounds.
    const cur = allEvents[replayAt - 1];
    const nxt = allEvents[replayAt];
    const gap = cur && nxt ? (new Date(nxt.ts).getTime() - new Date(cur.ts).getTime()) / 10 : 300;
    const timer = setTimeout(() => setReplayAt((n) => (n ?? 0) + 1), Math.min(900, Math.max(120, gap)));
    return () => clearTimeout(timer);
  }, [replayAt, allEvents]);
  const [filter, setFilter] = useState<Actor | null>(null);
  const [busy, setBusy] = useState<"stop" | "discard" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const feedRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const live = task ? isActive(task.status) : false;
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);

  useEffect(() => {
    const el = feedRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  // Re-subscribe when the task leaves a waiting state (answered from elsewhere).
  const status = task?.status;
  useEffect(() => {
    if (status) void refreshTasks();
  }, [status, refreshTasks]);

  const states = useMemo(() => nodeStates(events), [events]);
  const segs = useMemo(() => segments(events), [events]);
  const handBack = lastHandBack(events);

  if (error) return <p className="p-8 text-sm text-danger">{error}</p>;
  if (!task) {
    return (
      <div className="grid grow place-items-center text-muted">
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  const bounds = runBounds(events, task, now);
  const loopActive = task.round > 1 && states.forge === "active";
  const loopLabel = handBack !== null && task.round > 1 ? tf("issuesTo", { count: handBack, name: name("forge") }) : tf("loopLabel", { max: task.maxRounds });

  async function stop() {
    setBusy("stop");
    await api.stop(taskId).catch(() => undefined);
    setBusy(null);
  }

  async function discard() {
    if (!window.confirm(td("discardConfirm"))) return;
    setBusy("discard");
    await api.discard(taskId).catch(() => undefined);
    await refreshTasks();
    router.push(task ? `/w/${task.workspaceId}` : "/");
  }

  const ws = workspace(task.workspaceId);

  return (
    <WorkspaceScope workspaceId={task.workspaceId}>
    <div className="flex min-h-0 grow flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-[22px] py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-base font-semibold">{task.title}</h1>
            <StatusChip status={task.status}>
              {task.round > 0 && !isFinished(task.status) && <span className="text-muted">· {t("roundDivider", { round: task.round })}</span>}
            </StatusChip>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted">
            {ws && (
              <>
                <Link href={`/w/${ws.id}`} className="inline-flex items-center gap-1.5 hover:text-text">
                  <WorkspaceDot color={ws.color} />
                  {ws.name}
                  <span className="font-mono">/ {repo(task.repoId)?.name}</span>
                </Link>
                ·
              </>
            )}
            <Link href="/flows" className="hover:text-text">
              {tf("name")}
            </Link>
            {task.branch && (
              <>
                ·
                <span className="inline-flex items-center gap-1 font-mono">
                  <GitBranch className="size-3" aria-hidden="true" />
                  {task.branch}
                </span>
              </>
            )}
            · <span>{t("started", { time: timeAgo(task.createdAt, locale, now) })}</span>·<span className="font-mono">{formatCost(task.costUsd, locale)}</span>
          </div>
        </div>
        <span className="ml-auto flex gap-2">
          {!live && allEvents.length > 0 && (
            <Button onClick={() => setReplayAt(replayAt === null ? 1 : null)}>
              {replayAt === null ? <Play className="size-3.5" aria-hidden="true" /> : <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
              {replayAt === null ? t("replay") : t("replaying")}
            </Button>
          )}
          {task.status === "review" && (
            <Link href={`/runs/${task.id}/decide`} className={buttonClass("primary")}>
              {t("reviewMerge")}
            </Link>
          )}
          {live && (
            <Button variant="danger" onClick={stop} disabled={busy !== null}>
              {busy === "stop" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Square className="size-3.5" aria-hidden="true" />}
              {t("stop")}
            </Button>
          )}
          {(task.status === "waiting" || task.status === "review") && (
            <Button variant="ghost" onClick={discard} disabled={busy !== null} className="hover:text-danger">
              <Trash2 className="size-3.5" aria-hidden="true" />
              {t("discard")}
            </Button>
          )}
        </span>
      </header>

      <div className="flex min-h-0 grow flex-wrap">
        <section aria-label={tf("name")} className="dot-grid flex min-w-0 grow-[999] basis-[560px] flex-col">
          <div className="flex grow items-center overflow-x-auto px-4 py-8">
            <FlowGraph
              states={states}
              notes={graphNotes(events, (k, v) => t(k, v))}
              loopActive={loopActive}
              loopLabel={loopLabel}
              selected={filter}
              onSelect={(a) => setFilter((cur) => (cur === a ? null : a))}
            />
          </div>
          {task.status === "waiting" && (
            <div className="px-6 pb-6">
              <div className="mx-auto max-w-[760px]">
                <QuestionCard task={task} compact />
              </div>
            </div>
          )}
          <RunTimeline segments={segs} start={bounds.start} end={replayAt === null ? bounds.end : Math.max(bounds.start + 1000, new Date(events.at(-1)?.ts ?? task.createdAt).getTime())} live={live || replayAt !== null} />
        </section>

        <aside aria-label={t("everything")} className="flex max-h-[calc(100vh-61px)] min-h-[420px] max-w-[440px] grow basis-[360px] flex-col border-l border-border bg-panel">
          <nav aria-label={t("everything")} className="flex flex-wrap gap-1.5 border-b border-border px-4 py-3">
            {FILTERS.map((f) => (
              <button
                key={f ?? "all"}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs",
                  filter === f ? "border-border-strong bg-panel-2 text-text" : "border-transparent text-muted hover:text-text",
                )}
              >
                {f && <Glyph actor={f} size={16} className="rounded" />}
                {f ? name(f) : t("everything")}
              </button>
            ))}
          </nav>
          <div
            ref={feedRef}
            onScroll={() => {
              const el = feedRef.current;
              if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
            className="min-h-0 grow overflow-y-auto px-4 py-4"
          >
            <div className="mb-4 rounded-[10px] border border-border bg-panel-2 px-3.5 py-2.5 text-[13px] whitespace-pre-wrap">{task.prompt}</div>
            <ActivityFeed events={events} filter={filter} live={live} />
            {task.error && <p className="mt-3 text-[13px] text-danger">{task.error}</p>}
          </div>
          <div className="border-t border-border px-4 py-3 text-xs text-muted">{t("messageSoon")}</div>
        </aside>
      </div>
    </div>
    </WorkspaceScope>
  );
}
