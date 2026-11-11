"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Layers, Plus } from "lucide-react";
import { isActive, needsYou, type Task } from "@forgeboard/shared";
import { useAppState } from "@/lib/app-state";
import { formatCost } from "@/lib/utils";
import { AssumptionsCard, QuestionCard, ReviewCard, toCheck } from "./desk-cards";
import { StatusDot } from "./status-chip";
import { Composer, RunningStats } from "./top-bar";
import { Button, Card, SectionLabel } from "./ui";
import { WorkspaceDot, WorkspaceTile } from "./workspace-ui";

function NeedsYouCard({ task }: { task: Task }) {
  return task.status === "waiting" ? <QuestionCard task={task} showRepo /> : <ReviewCard task={task} showRepo />;
}

/** The "All" desk: every workspace at a glance, and everything waiting for you. */
export function Desk() {
  const t = useTranslations("desk");
  const tw = useTranslations("ws");
  const locale = useLocale();
  const { tasks: allTasks, activeWorkspaces, repos, repo, loaded, setNewWorkspaceOpen } = useAppState();

  if (loaded && activeWorkspaces.length === 0) {
    return (
      <main className="grid grow place-items-center px-6">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <Layers className="size-8 text-muted" aria-hidden="true" />
          <h1 className="text-2xl font-semibold tracking-tight">{tw("noWorkspacesTitle")}</h1>
          <p className="text-muted">{tw("noWorkspacesBody")}</p>
          <Button variant="primary" onClick={() => setNewWorkspaceOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {tw("create")}
          </Button>
        </div>
      </main>
    );
  }

  const visible = new Set(activeWorkspaces.map((w) => w.id));
  const tasks = allTasks.filter((x) => visible.has(x.workspaceId));
  const waiting = tasks.filter((x) => needsYou(x.status));
  const working = tasks.filter((x) => isActive(x.status));
  const wsWithWaiting = activeWorkspaces.filter((w) => waiting.some((x) => x.workspaceId === w.id));
  const today = new Date().toDateString();

  return (
    <>
      <header className="flex flex-wrap items-center gap-3.5 border-b border-border px-7 py-3.5">
        <div className="flex min-w-[180px] items-center gap-2.5">
          <span className="font-semibold">{tw("all")}</span>
          <span className="inline-flex h-6 items-center rounded-full border border-border bg-panel-2 px-2.5 text-xs text-muted">{activeWorkspaces.length}</span>
        </div>
        <Composer className="mx-auto min-w-[280px] max-w-[700px] grow basis-[380px]" />
        <RunningStats tasks={tasks} />
      </header>

      <main className="flex justify-center px-8 py-[26px]">
        <div className="flex w-full max-w-[1240px] flex-col gap-6">
          <div>
            <h1 className="text-[26px] font-semibold tracking-[-0.02em]">
              {waiting.length > 0 ? tw("headlineAll", { count: waiting.length, ws: wsWithWaiting.length }) : t("headlineNone")}
            </h1>
            <p className="mt-1.5 text-muted">{t("sub", { count: working.length })}</p>
          </div>

          <section aria-label={tw("all")} className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
            {activeWorkspaces.map((ws) => {
              const wsTasks = tasks.filter((x) => x.workspaceId === ws.id);
              const w = wsTasks.filter((x) => needsYou(x.status)).length;
              const r = wsTasks.filter((x) => isActive(x.status)).length;
              const cost = wsTasks.filter((x) => new Date(x.createdAt).toDateString() === today).reduce((s, x) => s + x.costUsd, 0);
              const repoCount = repos.filter((x) => x.workspaceId === ws.id).length;
              return (
                <Link key={ws.id} href={`/w/${ws.id}`} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-panel px-4 py-3.5 hover:border-border-strong">
                  <span className="flex items-center gap-2.5">
                    <WorkspaceTile workspace={ws} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{ws.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {[ws.description, tw("repoCount", { count: repoCount })].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </span>
                  <span className="flex gap-3.5 text-[12.5px]">
                    {w > 0 ? <span className="text-accent">{tw("waiting", { count: w })}</span> : <span className="text-success">{tw("upToDate")}</span>}
                    {r > 0 ? <span className="text-info">{tw("running", { count: r })}</span> : <span className="text-muted">{tw("idle")}</span>}
                    <span className="ml-auto font-mono text-muted">{formatCost(cost, locale)}</span>
                  </span>
                </Link>
              );
            })}
          </section>

          <div className="flex flex-wrap items-start gap-5">
            <section aria-label={t("needsYou")} className="flex min-w-0 grow-[999] basis-[560px] flex-col gap-3">
              <SectionLabel>{t("needsYou")}</SectionLabel>
              {waiting.length === 0 && <Card className="border-dashed p-6 text-[13.5px] text-muted">{t("nothingWaiting")}</Card>}
              {wsWithWaiting.map((ws) => {
                const list = waiting.filter((x) => x.workspaceId === ws.id);
                return (
                  <div key={ws.id} className="flex flex-col gap-3">
                    <Link href={`/w/${ws.id}`} className="mt-0.5 flex items-center gap-2 text-[12.5px] text-muted hover:text-text">
                      <WorkspaceDot color={ws.color} />
                      <span className="font-medium text-text">{ws.name}</span>· {list.length}
                    </Link>
                    {list.map((task) => (
                      <NeedsYouCard key={task.id} task={task} />
                    ))}
                  </div>
                );
              })}
              {toCheck(tasks).length > 0 && (
                <>
                  <SectionLabel className="mt-2.5">{t("toCheck").toUpperCase()}</SectionLabel>
                  {toCheck(tasks).map((task) => (
                    <AssumptionsCard key={task.id} task={task} showRepo />
                  ))}
                </>
              )}
            </section>

            <aside aria-label={t("atWork")} className="flex max-w-[420px] grow basis-[340px] flex-col gap-3">
              <SectionLabel>{t("atWork")}</SectionLabel>
              {working.length === 0 ? (
                <p className="text-[13px] text-muted">{t("nobodyWorking")}</p>
              ) : (
                <Card className="divide-y divide-border px-3.5 py-1">
                  {working.map((task) => {
                    const ws = activeWorkspaces.find((w) => w.id === task.workspaceId);
                    return (
                      <Link key={task.id} href={`/runs/${task.id}`} className="flex items-center gap-2.5 py-[11px] text-[13px]">
                        {ws ? <WorkspaceDot color={ws.color} /> : <StatusDot status={task.status} />}
                        <span className="min-w-0 truncate">{task.title}</span>
                        <span className="ml-auto shrink-0 font-mono text-[11.5px] text-muted">{repo(task.repoId)?.name}</span>
                      </Link>
                    );
                  })}
                </Card>
              )}
              <p className="text-[12.5px] text-muted">{tw("colorHint")}</p>
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}
