"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, ListChecks, Loader2, SlidersHorizontal } from "lucide-react";
import { isActive, isFinished, needsYou, type Task } from "@forgeboard/shared";
import { api } from "@/lib/api";
import { useTaskAgents } from "@/lib/use-task-agents";
import { ChooseFolderButton } from "./folder-picker";
import { useAppState, WorkspaceScope } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { AssumptionsCard, QuestionCard, RecentRow, ReviewCard, toCheck } from "./desk-cards";
import { Glyph } from "./glyph";
import { Composer, RunningStats } from "./top-bar";
import { Button, buttonClass, Card, Chip, SectionLabel } from "./ui";
import { WorkspaceTile } from "./workspace-ui";

function AddRepoInline({ workspaceId }: { workspaceId: string }) {
  const tw = useTranslations("ws");
  const t = useTranslations("repo");
  const tc = useTranslations("common");
  const { refreshRepos } = useAppState();
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    await add(path);
  }

  async function add(repoPath: string) {
    setBusy(true);
    setError(null);
    try {
      await api.addRepo(workspaceId, repoPath);
      setPath("");
      await refreshRepos();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 border-dashed p-5">
      <p className="text-[13.5px] text-muted">{tw("emptyRepos")}</p>
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <ChooseFolderButton variant="primary" onPick={(p) => void add(p)} />
        <label htmlFor="ws-add-repo" className="sr-only">
          {tw("addRepoHere")}
        </label>
        <input
          id="ws-add-repo"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder={t("addPlaceholder")}
          className="h-[34px] min-w-0 grow rounded-lg border border-border bg-bg px-3 font-mono text-[12.5px] outline-none focus:border-border-strong"
        />
        <Button type="submit" disabled={!path.trim() || busy}>
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          {tc("add")}
        </Button>
      </form>
      <p className="text-xs text-muted">{t("addHint")}</p>
      {error && <p className="text-xs text-danger">{error}</p>}
    </Card>
  );
}

const PROVIDER_LABEL: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex", mock: "Mock" };

export function WorkspaceDesk({ workspaceId, repoFilter }: { workspaceId: string; repoFilter?: string }) {
  const t = useTranslations("desk");
  const tw = useTranslations("ws");
  const tc = useTranslations("common");
  const tcrew = useTranslations("crew");
  const { workspace, repos: allRepos, tasks: allTasks, crews, loaded, teams } = useAppState();
  const [ruleCounts, setRuleCounts] = useState<{ ws: number; repo: number } | null>(null);
  const ws = workspace(workspaceId);
  const repos = allRepos.filter((r) => r.workspaceId === workspaceId);
  const repoKey = repos.map((r) => r.id).join(",");

  useEffect(() => {
    let alive = true;
    Promise.all([api.rules("workspace", workspaceId), ...repoKey.split(",").filter(Boolean).map((id) => api.rules("repo", id))])
      .then(([wsRules, ...repoRules]) => alive && setRuleCounts({ ws: wsRules!.length, repo: repoRules.reduce((s, r) => s + r.length, 0) }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [workspaceId, repoKey]);

  if (!ws) {
    return loaded ? <p className="p-8 text-muted">{tw("notFound")}</p> : null;
  }

  const filter = repos.some((r) => r.id === repoFilter) ? repoFilter : undefined;
  const wsTasks = allTasks.filter((x) => x.workspaceId === workspaceId);
  const tasks = filter ? wsTasks.filter((x) => x.repoId === filter) : wsTasks;
  const waiting = tasks.filter((x) => needsYou(x.status));
  const working = tasks.filter((x) => isActive(x.status));
  const recent = tasks.filter((x) => isFinished(x.status)).slice(0, 5);
  const crew = crews[workspaceId] ?? [];
  const repoName = (id: string) => repos.find((r) => r.id === id)?.name ?? "—";

  return (
    <WorkspaceScope workspaceId={workspaceId}>
      <header className="flex flex-col gap-3 border-b border-border px-7 pt-4 pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <WorkspaceTile workspace={ws} size={34} />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{ws.name}</h1>
            <div className="text-[12.5px] text-muted">
              {[
                ws.description,
                tw("repoCount", { count: repos.length }),
                ws.crewMode === "team" ? (teams.find((x) => x.id === ws.teamId)?.name ?? tw("crewDefault")) : ws.crewMode === "custom" ? tw("crewCustom") : tw("crewDefault"),
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <Composer workspaceId={workspaceId} repoId={filter} className="mx-auto min-w-[280px] max-w-[640px] grow basis-[360px]" />
          <RunningStats tasks={wsTasks} />
          <Link href={`/w/${workspaceId}/settings`} className={buttonClass("secondary")}>
            <SlidersHorizontal className="size-3.5" aria-hidden="true" />
            {tw("configure")}
          </Link>
        </div>
        {repos.length > 1 && (
          <nav aria-label={tw("filterByRepo")} className="flex flex-wrap gap-1.5">
            {[{ id: undefined, name: tw("allRepos") }, ...repos].map((r) => {
              const active = filter === r.id;
              const hasWaiting = r.id && wsTasks.some((x) => x.repoId === r.id && needsYou(x.status));
              return (
                <Link
                  key={r.id ?? "all"}
                  href={r.id ? `/w/${workspaceId}?repo=${r.id}` : `/w/${workspaceId}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-[12.5px]",
                    r.id && "font-mono",
                    active ? "border-border-strong bg-panel-2 text-text" : "border-transparent text-muted hover:text-text",
                  )}
                >
                  {r.name}
                  {!r.id && <span className="font-mono text-[11px] text-muted">{repos.length}</span>}
                  {hasWaiting && <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />}
                </Link>
              );
            })}
          </nav>
        )}
      </header>

      <main className="flex flex-wrap items-start gap-5 px-7 py-6">
        <section aria-label={t("needsYou")} className="flex min-w-0 grow-[999] basis-[560px] flex-col gap-3">
          {repos.length === 0 ? (
            <AddRepoInline workspaceId={workspaceId} />
          ) : (
            <>
              <SectionLabel>
                {t("needsYou")} · {waiting.length}
              </SectionLabel>
              {waiting.length === 0 && <Card className="border-dashed p-6 text-[13.5px] text-muted">{t("nothingWaiting")}</Card>}
              {waiting.map((task) =>
                task.status === "waiting" ? <QuestionCard key={task.id} task={task} showRepo={repos.length > 1} /> : <ReviewCard key={task.id} task={task} showRepo={repos.length > 1} />,
              )}

              {toCheck(tasks).length > 0 && (
                <>
                  <SectionLabel className="mt-2.5">
                    {t("toCheck").toUpperCase()} · {toCheck(tasks).length}
                  </SectionLabel>
                  {toCheck(tasks).map((task) => (
                    <AssumptionsCard key={task.id} task={task} showRepo={repos.length > 1} />
                  ))}
                </>
              )}

              <SectionLabel className="mt-2.5">
                {t("atWork")} · {working.length}
              </SectionLabel>
              {working.length === 0 ? (
                <p className="text-[13px] text-muted">{t("nobodyWorking")}</p>
              ) : (
                <Card className="divide-y divide-border px-3.5 py-1">
                  {working.map((task) => (
                    <Link key={task.id} href={`/runs/${task.id}`} className="flex items-center gap-2.5 py-[11px] text-[13px]">
                      <TaskBuilderGlyph task={task} />
                      <span className="min-w-0 truncate">{task.title}</span>
                      <Chip className="ml-auto h-[22px] shrink-0 font-mono">{repoName(task.repoId)}</Chip>
                      <span className="shrink-0 text-xs text-info">{task.round > 0 ? tc("round", { round: task.round, max: task.maxRounds }) : ""}</span>
                    </Link>
                  ))}
                </Card>
              )}

              {recent.length > 0 && (
                <>
                  <SectionLabel className="mt-2.5">{t("recent")}</SectionLabel>
                  <Card className="divide-y divide-border px-3.5 py-1">
                    {recent.map((task) => (
                      <RecentRow key={task.id} task={task} />
                    ))}
                  </Card>
                </>
              )}
            </>
          )}
        </section>

        <aside aria-label={ws.name} className="flex max-w-[420px] grow basis-[340px] flex-col gap-3">
          <SectionLabel>{tw("repos")}</SectionLabel>
          <Card className="divide-y divide-border px-3.5 py-1">
            {repos.map((r) => {
              const rTasks = wsTasks.filter((x) => x.repoId === r.id);
              const w = rTasks.filter((x) => needsYou(x.status)).length;
              const run = rTasks.filter((x) => isActive(x.status)).length;
              return (
                <Link key={r.id} href={`/w/${workspaceId}?repo=${r.id}`} className="flex flex-col gap-1.5 py-3">
                  <span className="flex items-center gap-2">
                    <span className="font-mono font-medium">{r.name}</span>
                    <span className="ml-auto text-xs">
                      {w > 0 ? <span className="text-accent">{tw("waiting", { count: w })}</span> : <span className="text-success">{tw("upToDate")}</span>}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {r.checks.length === 0 ? (
                      <span className="text-xs text-muted">{tw("noChecks")}</span>
                    ) : (
                      r.checks.map((c) => (
                        <Chip key={c.name} className="h-5 font-mono text-[11px]">
                          {c.name}
                        </Chip>
                      ))
                    )}
                    {run > 0 && <span className="ml-auto text-xs text-muted">{tw("running", { count: run })}</span>}
                  </span>
                </Link>
              );
            })}
            {repos.length === 0 && <p className="py-3 text-[12.5px] text-muted">{tw("emptyRepos")}</p>}
          </Card>

          <SectionLabel className="mt-1.5">{tw("crew")}</SectionLabel>
          <Card className="divide-y divide-border px-3.5 py-1">
            {crew.map((a) => (
              <div key={a.id} className="flex items-center gap-2.5 py-[11px] text-[13px]">
                <Glyph actor={a.id} />
                <span>{a.name}</span>
                <span className="truncate text-xs text-muted">{PROVIDER_LABEL[a.provider]} · {tcrew(a.personality)}</span>
                {/* Default or customized only means something next to the default team. */}
                {ws.crewMode !== "team" && (
                  <Chip className={cn("ml-auto h-5 text-[11px]", a.customized && "border-info/35 text-info")}>{a.customized ? tw("custom") : tw("default")}</Chip>
                )}
              </div>
            ))}
          </Card>

          <Link href={`/w/${workspaceId}/settings#rules`} className="flex items-center gap-2.5 rounded-2xl border border-border bg-panel px-3.5 py-3 text-[13px] hover:border-border-strong">
            <ListChecks className="size-[15px] text-muted" aria-hidden="true" />
            <span className="whitespace-nowrap">{tw("rules")}</span>
            {ruleCounts && <span className="truncate text-xs text-muted">{tw("rulesSummary", { ws: ruleCounts.ws, repo: ruleCounts.repo })}</span>}
            <ChevronRight className="ml-auto size-3.5 text-muted" aria-hidden="true" />
          </Link>
        </aside>
      </main>
    </WorkspaceScope>
  );
}

/** The agent a task is "for": its flow's first builder. */
function TaskBuilderGlyph({ task }: { task: Task }) {
  const { builder } = useTaskAgents(task);
  return <Glyph actor={builder} size={22} />;
}
