"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, Loader2, Sparkles, Workflow } from "lucide-react";
import { BUILD_AND_REVIEW_ID, isActive, type Locale, type Task } from "@forgeboard/shared";
import { api } from "@/lib/api";
import { useAppState } from "@/lib/app-state";
import { cn, formatCost } from "@/lib/utils";
import { useFlowName } from "./flow-graph";
import { Button, Kbd } from "./ui";

/**
 * The task bar. Inside a workspace it picks among that workspace's repos;
 * on the "All" desk it lists every repo grouped by workspace.
 */
export function Composer({ workspaceId, repoId: preferredRepo, className }: { workspaceId?: string; repoId?: string; className?: string }) {
  const t = useTranslations("composer");
  const router = useRouter();
  const locale = useLocale() as Locale;
  const { repos, activeWorkspaces, workspace, lastRepoId, rememberRepo, refreshTasks, flows, teams } = useAppState();
  const flowName = useFlowName();
  const [prompt, setPrompt] = useState("");
  const [repoId, setRepoId] = useState<string>("");
  const [flowId, setFlowId] = useState<string>(BUILD_AND_REVIEW_ID);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleWs = workspaceId ? activeWorkspaces.filter((w) => w.id === workspaceId) : activeWorkspaces;
  const choices = repos.filter((r) => visibleWs.some((w) => w.id === r.workspaceId));

  // Pick a sensible repo: the filtered one, the last used, or the first available.
  useEffect(() => {
    if (choices.some((r) => r.id === repoId) && !preferredRepo) return;
    const pick = [preferredRepo, lastRepoId].find((id) => id && choices.some((r) => r.id === id)) ?? choices[0]?.id ?? "";
    setRepoId(pick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choices.map((r) => r.id).join(","), preferredRepo, lastRepoId]);

  // The flow follows the chosen repo's workspace default until you pick another.
  const repoWs = workspace(repos.find((r) => r.id === repoId)?.workspaceId);
  const repoTeam = repoWs?.crewMode === "team" ? teams.find((x) => x.id === repoWs.teamId) : undefined;
  const wsDefault = [repoWs?.defaultFlowId, repoTeam?.planning].find((id) => id && flows.some((f) => f.id === id)) ?? BUILD_AND_REVIEW_ID;
  useEffect(() => setFlowId(wsDefault), [wsDefault]);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!repoId || !prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const task = await api.createTask({ repoId, prompt: prompt.trim(), locale, flowId });
      rememberRepo(repoId);
      setPrompt("");
      void refreshTasks();
      router.push(`/runs/${task.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  const ws = workspace(workspaceId);
  const placeholder = choices.length === 0 ? (workspaceId ? t("noRepos") : t("needsRepo")) : ws ? t("placeholderWs", { name: ws.name }) : t("placeholder");

  return (
    <form onSubmit={submit} className={cn("relative", className)}>
      <div className="flex min-h-[42px] items-center gap-2.5 rounded-[11px] border border-[#232327] bg-panel py-1 pr-1.5 pl-3.5 focus-within:border-border-strong">
        <Sparkles className="size-4 shrink-0 text-accent" aria-hidden="true" />
        <label htmlFor="composer" className="sr-only">
          {t("label")}
        </label>
        <textarea
          id="composer"
          rows={1}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={choices.length === 0}
          placeholder={placeholder}
          className="max-h-32 min-w-0 grow resize-none bg-transparent py-1.5 leading-6 outline-none placeholder:text-muted [field-sizing:content]"
        />
        {choices.length > 0 && (
          <label className="relative inline-flex h-[30px] shrink-0 items-center rounded-lg border border-border bg-panel-2 pr-7 pl-2.5 text-xs">
            <span className="sr-only">{t("destination")}</span>
            <select value={repoId} onChange={(e) => setRepoId(e.target.value)} className="appearance-none bg-transparent font-mono outline-none">
              {workspaceId
                ? choices.map((r) => (
                    <option key={r.id} value={r.id} className="bg-panel">
                      {r.name}
                    </option>
                  ))
                : visibleWs.map((w) => (
                    <optgroup key={w.id} label={w.name} className="bg-panel">
                      {choices
                        .filter((r) => r.workspaceId === w.id)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {w.name} / {r.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 size-3 text-muted" aria-hidden="true" />
          </label>
        )}
        {flows.length > 1 && choices.length > 0 && (
          <label className="relative inline-flex h-[30px] max-w-[180px] shrink-0 items-center gap-1.5 rounded-lg border border-border bg-panel-2 pr-7 pl-2 text-xs">
            <Workflow className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
            <span className="sr-only">{t("flow")}</span>
            <select value={flowId} onChange={(e) => setFlowId(e.target.value)} className="min-w-0 appearance-none truncate bg-transparent outline-none">
              {flows.map((f) => (
                <option key={f.id} value={f.id} className="bg-panel">
                  {flowName(f)}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 size-3 text-muted" aria-hidden="true" />
          </label>
        )}
        {prompt.trim() ? (
          <Button variant="primary" type="submit" disabled={busy || !repoId} className="h-8">
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
            {t("start")}
          </Button>
        ) : (
          <Kbd>↵</Kbd>
        )}
      </div>
      {error && <p className="absolute top-full mt-1 text-xs text-danger">{error}</p>}
    </form>
  );
}

export function RunningStats({ tasks }: { tasks: Task[] }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const running = tasks.filter((x) => isActive(x.status)).length;
  const today = new Date().toDateString();
  const costToday = tasks.filter((x) => new Date(x.createdAt).toDateString() === today).reduce((s, x) => s + x.costUsd, 0);
  return (
    <span className="flex items-center gap-2.5 text-[12.5px] text-muted">
      {running > 0 && (
        <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-info/35 px-2.5 text-info">
          <span className="size-[7px] rounded-full bg-info" aria-hidden="true" />
          {t("running", { count: running })}
        </span>
      )}
      <span className="font-mono">{t("costToday", { cost: formatCost(costToday, locale) })}</span>
    </span>
  );
}
