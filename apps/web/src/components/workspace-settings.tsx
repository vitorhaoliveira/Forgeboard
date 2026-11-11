"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import type { CheckCommand, ForgeCommands, Repo, WorkspaceColor } from "@forgeboard/shared";
import { api } from "@/lib/api";
import { useAppState, WorkspaceScope } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { AgentCard } from "./crew-view";
import { ColorPicker } from "./new-workspace-dialog";
import { RulesEditor, type RuleTarget } from "./rules-editor";
import { Button, Card, Chip } from "./ui";
import { WorkspaceTile } from "./workspace-ui";

function Section({ id, title, children, className }: { id: string; title: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("flex scroll-mt-6 flex-col gap-4 rounded-2xl border border-border bg-panel p-5", className)}>
      <h2 id={`${id}-title`} className="text-[15px] font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ChecksEditor({ repo }: { repo: Repo }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { refreshRepos } = useAppState();
  const [rows, setRows] = useState<CheckCommand[]>(repo.checks);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(rows) !== JSON.stringify(repo.checks);
  const valid = rows.every((r) => r.name.trim() && r.command.trim());

  async function save() {
    setState("saving");
    setError(null);
    try {
      await api.updateRepo(repo.id, { checks: rows.map((r) => ({ name: r.name.trim(), command: r.command.trim() })) });
      await refreshRepos();
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
  }

  return (
    <div className="flex flex-col gap-2.5 border-t border-border bg-bg/40 px-3.5 py-3">
      <p className="text-xs text-muted">{t("checksHint")}</p>
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[130px_minmax(0,1fr)_32px] gap-2">
          <input
            aria-label={t("checkName")}
            value={row.name}
            onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
            className="h-8 rounded-lg border border-border bg-bg px-2.5 text-[13px] outline-none focus:border-border-strong"
          />
          <input
            aria-label={t("checkCommand")}
            value={row.command}
            onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, command: e.target.value } : r)))}
            className="h-8 rounded-lg border border-border bg-bg px-2.5 font-mono text-[12.5px] outline-none focus:border-border-strong"
          />
          <button
            type="button"
            aria-label={`${tc("delete")} ${row.name}`}
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
            className="grid size-8 place-items-center rounded-lg text-muted hover:text-danger"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex justify-between gap-2">
        <Button variant="ghost" onClick={() => setRows([...rows, { name: "", command: "" }])}>
          <Plus className="size-3.5" aria-hidden="true" />
          {t("addCheck")}
        </Button>
        <Button variant="primary" onClick={save} disabled={!dirty || !valid || state === "saving"}>
          {state === "saving" && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          {state === "saved" && <Check className="size-3.5" aria-hidden="true" />}
          {state === "saved" ? tc("saved") : tc("save")}
        </Button>
      </div>
    </div>
  );
}

function RepoRow({ repo, workspaceId }: { repo: Repo; workspaceId: string }) {
  const t = useTranslations("wsSettings");
  const { activeWorkspaces, refreshRepos, refreshTasks } = useAppState();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = activeWorkspaces.filter((w) => w.id !== workspaceId);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await Promise.all([refreshRepos(), refreshTasks()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="border-t border-border first:border-t-0">
      <div className="flex flex-wrap items-center gap-2.5 px-3.5 py-3">
        <span className="font-mono font-medium">{repo.name}</span>
        <span className="min-w-0 truncate font-mono text-xs text-muted">{repo.path}</span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {repo.checks.length === 0 ? (
            <span className="text-xs text-muted">{t("noChecks")}</span>
          ) : (
            repo.checks.map((c) => (
              <Chip key={c.name} className="h-[22px] font-mono text-[11.5px]">
                {c.name}
              </Chip>
            ))
          )}
        </span>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-[12.5px] text-accent">
          {t("checks")}
        </button>
        {others.length > 0 && (
          <select
            aria-label={t("moveTo", { repo: repo.name })}
            value=""
            onChange={(e) => e.target.value && act(() => api.updateRepo(repo.id, { workspaceId: e.target.value }))}
            className="h-7 max-w-36 rounded-md border border-border bg-panel-2 px-1.5 text-xs outline-none"
          >
            <option value="">→ …</option>
            {others.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => window.confirm(t("removeRepoConfirm", { repo: repo.name })) && act(() => api.removeRepo(repo.id))}
          className="text-[12.5px] text-muted hover:text-danger"
        >
          {t("removeRepo")}
        </button>
      </div>
      {error && <p className="px-3.5 pb-2.5 text-xs text-danger">{error}</p>}
      {open && <ChecksEditor repo={repo} />}
    </div>
  );
}

export function WorkspaceSettings({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("wsSettings");
  const tn = useTranslations("newWs");
  const tw = useTranslations("ws");
  const tc = useTranslations("common");
  const router = useRouter();
  const { workspace, repos: allRepos, crews, loaded, agentName, refreshWorkspaces, refreshRepos, refreshCrews } = useAppState();
  const ws = workspace(workspaceId);
  const repos = allRepos.filter((r) => r.workspaceId === workspaceId);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<WorkspaceColor>("info");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [repoPath, setRepoPath] = useState("");
  const [rulesTab, setRulesTab] = useState<string>("workspace");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ws) return;
    setName(ws.name);
    setDescription(ws.description);
    setColor(ws.color);
  }, [ws?.id, ws?.name, ws?.description, ws?.color]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ws) return loaded ? <p className="p-8 text-muted">{tw("notFound")}</p> : null;
  const generalDirty = name.trim() !== ws.name || description.trim() !== ws.description || color !== ws.color;

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveGeneral() {
    setSaveState("saving");
    await act(async () => {
      await api.updateWorkspace(workspaceId, { name: name.trim(), description: description.trim(), color });
      await refreshWorkspaces();
    });
    setSaveState("saved");
    setTimeout(() => setSaveState("idle"), 1500);
  }

  async function addRepo(e: FormEvent) {
    e.preventDefault();
    await act(async () => {
      await api.addRepo(workspaceId, repoPath);
      setRepoPath("");
      await refreshRepos();
    });
  }

  async function updateWs(patch: Parameters<typeof api.updateWorkspace>[1]) {
    await act(async () => {
      await api.updateWorkspace(workspaceId, patch);
      await refreshWorkspaces();
    });
  }

  async function setForgeCommands(value: ForgeCommands) {
    await act(async () => {
      await api.updateWorkspace(workspaceId, { forgeCommands: value });
      await refreshWorkspaces();
    });
  }

  async function setCrewMode(mode: "default" | "custom") {
    await act(async () => {
      await api.updateWorkspace(workspaceId, { crewMode: mode });
      await Promise.all([refreshWorkspaces(), refreshCrews()]);
    });
  }

  const ruleTabs: (RuleTarget & { key: string; title: string })[] = [
    { key: "workspace", title: t("rulesWorkspace"), label: t("moveToWorkspace"), scope: "workspace", id: workspaceId },
    ...repos.map((r) => ({ key: r.id, title: r.name, label: t("moveToRepo", { repo: r.name }), scope: "repo" as const, id: r.id })),
  ];
  const currentTab = ruleTabs.find((x) => x.key === rulesTab) ?? ruleTabs[0]!;

  return (
    <WorkspaceScope workspaceId={workspaceId}>
      <div className="flex grow flex-wrap">
        <aside aria-label={t("title")} className="shrink-0 basis-[220px] border-r border-border px-4 py-[26px]">
          <Link href={`/w/${workspaceId}`} className="block px-2.5 pb-3.5 text-[13px] text-muted hover:text-text">
            {t("back", { name: ws.name })}
          </Link>
          {(["general", "repos", "crew", "conversation", "safety", "rules", "danger"] as const).map((key) => (
            <a key={key} href={`#${key}`} className="block rounded-[7px] px-2.5 py-[7px] text-[13px] text-muted hover:bg-panel-2 hover:text-text">
              {t(key)}
            </a>
          ))}
        </aside>

        <main className="flex min-w-0 grow-[999] basis-[600px] justify-center px-8 pt-[26px] pb-10">
          <div className="flex w-full max-w-[860px] flex-col gap-[22px]">
            <h1 className="text-[22px] font-semibold">{t("title")}</h1>
            {error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}

            <Section id="general" title={t("general")}>
              <div className="flex flex-wrap items-end gap-4">
                <WorkspaceTile workspace={{ name: name || "?", color }} size={52} />
                <label className="flex grow basis-[200px] flex-col gap-1.5">
                  <span className="text-xs text-muted">{tn("name")}</span>
                  <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="h-9 rounded-lg border border-border bg-bg px-3 outline-none focus:border-border-strong" />
                </label>
                <label className="flex grow basis-[200px] flex-col gap-1.5">
                  <span className="text-xs text-muted">{tn("description")}</span>
                  <input
                    value={description}
                    maxLength={80}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={tn("descriptionPlaceholder")}
                    className="h-9 rounded-lg border border-border bg-bg px-3 outline-none focus:border-border-strong"
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-muted">{tn("color")}</span>
                  <ColorPicker value={color} onChange={setColor} label={tn("color")} />
                </div>
                <Button variant="primary" onClick={saveGeneral} disabled={!generalDirty || !name.trim() || saveState === "saving"}>
                  {saveState === "saving" && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                  {saveState === "saved" && <Check className="size-3.5" aria-hidden="true" />}
                  {saveState === "saved" ? tc("saved") : t("save")}
                </Button>
              </div>
            </Section>

            <Section id="repos" title={t("repos")}>
              {repos.length > 0 && (
                <div className="overflow-hidden rounded-[10px] border border-border">
                  {repos.map((r) => (
                    <RepoRow key={r.id} repo={r} workspaceId={workspaceId} />
                  ))}
                </div>
              )}
              <form onSubmit={addRepo} className="flex gap-2">
                <label htmlFor="ws-settings-repo" className="sr-only">
                  {t("addRepo")}
                </label>
                <input
                  id="ws-settings-repo"
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  placeholder={tn("repoPlaceholder")}
                  className="h-[34px] min-w-0 grow rounded-lg border border-border bg-bg px-3 font-mono text-[12.5px] outline-none focus:border-border-strong"
                />
                <Button type="submit" disabled={!repoPath.trim()}>
                  <Plus className="size-3.5" aria-hidden="true" />
                  {t("addRepo")}
                </Button>
              </form>
              <p className="text-[12.5px] text-muted">{t("repoHint")}</p>
            </Section>

            <Section id="crew" title={t("crew")}>
              <div role="radiogroup" aria-label={t("crew")} className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {(["default", "custom"] as const).map((mode) => {
                  const on = ws.crewMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => !on && setCrewMode(mode)}
                      className={cn("flex flex-col gap-1 rounded-[10px] border px-3.5 py-3 text-left", on ? "border-border-strong bg-panel-2" : "border-border hover:border-border-strong")}
                    >
                      <span className="flex items-center gap-2 font-medium">
                        {mode === "default" ? t("crewDefault") : t("crewCustom", { name: ws.name })}
                        {on && <Check className="ml-auto size-3.5" aria-hidden="true" />}
                      </span>
                      <span className="text-[12.5px] text-muted">{mode === "default" ? t("crewDefaultHint") : t("crewCustomHint")}</span>
                    </button>
                  );
                })}
              </div>
              {ws.crewMode === "custom" && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3.5">
                  {(crews[workspaceId] ?? []).map((a) => (
                    <AgentCard key={a.id} agent={a} workspaceId={workspaceId} />
                  ))}
                </div>
              )}
            </Section>

            <Section id="conversation" title={t("conversation")}>
              <div role="radiogroup" aria-label={t("askTitle")} className="flex flex-col gap-2.5">
                <div>
                  <div className="text-[13.5px] font-medium">{t("askTitle")}</div>
                  <div className="text-[12.5px] text-muted">{t("askHint")}</div>
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {(["ask", "decide"] as const).map((mode) => {
                    const on = (ws.askMode ?? "ask") === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => !on && updateWs({ askMode: mode })}
                        className={cn("flex flex-col gap-1 rounded-[10px] border px-3.5 py-3 text-left", on ? "border-border-strong bg-panel-2" : "border-border hover:border-border-strong")}
                      >
                        <span className="flex items-center gap-2 font-medium">
                          {mode === "ask" ? t("askAsk") : t("askDecide")}
                          {mode === "decide" && <Chip tone="accent">{t("recommended")}</Chip>}
                          {on && <Check className="ml-auto size-3.5" aria-hidden="true" />}
                        </span>
                        <span className="text-[12.5px] text-muted">{mode === "ask" ? t("askAskHint") : t("askDecideHint")}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-col">
                <SettingToggle
                  on={ws.planFirst ?? true}
                  onChange={(v) => updateWs({ planFirst: v })}
                  title={t("planFirst", { name: agentName("forge", workspaceId) })}
                  hint={t("planFirstHint")}
                />
                <SettingToggle
                  on={(ws.messageDelivery ?? "now") === "now"}
                  onChange={(v) => updateWs({ messageDelivery: v ? "now" : "later" })}
                  title={t("interrupt")}
                  hint={t("interruptHint")}
                />
                <NotifyToggle />
              </div>
            </Section>

            <Section id="safety" title={t("safety")}>
              <div role="radiogroup" aria-label={t("forgeCommands", { name: agentName("forge", workspaceId) })} className="flex flex-col gap-2.5">
                <span className="text-[13px] font-medium">{t("forgeCommands", { name: agentName("forge", workspaceId) })}</span>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {(["standard", "restricted"] as const).map((value) => {
                    const on = (ws.forgeCommands ?? "standard") === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => !on && setForgeCommands(value)}
                        className={cn("flex flex-col gap-1 rounded-[10px] border px-3.5 py-3 text-left", on ? "border-border-strong bg-panel-2" : "border-border hover:border-border-strong")}
                      >
                        <span className="flex items-center gap-2 font-medium">
                          {value === "standard" ? t("cmdStandard") : t("cmdRestricted")}
                          {on && <Check className="ml-auto size-3.5" aria-hidden="true" />}
                        </span>
                        <span className="text-[12.5px] text-muted">{value === "standard" ? t("cmdStandardHint") : t("cmdRestrictedHint")}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[12.5px] text-muted">{t("safetyNote")}</p>
              </div>
            </Section>

            <Section id="rules" title={t("rules")}>
              <p className="-mt-2 text-[12.5px] text-muted">{t("rulesHint")}</p>
              <div role="tablist" aria-label={t("rules")} className="flex flex-wrap gap-0.5 self-start rounded-[9px] border border-border bg-bg p-[3px]">
                {ruleTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={currentTab.key === tab.key}
                    onClick={() => setRulesTab(tab.key)}
                    className={cn(
                      "h-[30px] rounded-[7px] px-3 text-[12.5px]",
                      tab.scope === "repo" && "font-mono",
                      currentTab.key === tab.key ? "bg-panel-2 text-text shadow-[inset_0_0_0_1px_var(--border)]" : "text-muted hover:text-text",
                    )}
                  >
                    {tab.title}
                  </button>
                ))}
              </div>
              <RulesEditor
                key={currentTab.key}
                scope={currentTab.scope}
                id={currentTab.id}
                placeholder={t("addRuleFor", { target: currentTab.scope === "workspace" ? ws.name : currentTab.title })}
                moveTargets={ruleTabs.filter((x) => x.key !== currentTab.key)}
              />
              <p className="text-[12.5px] text-muted">
                {t("generalRulesNote")}{" "}
                <Link href="/crew" className="text-accent underline">
                  {t("seeGeneral")}
                </Link>
              </p>
            </Section>

            <Card className="flex flex-wrap items-center gap-3 border-danger/25 p-5" >
              <div id="danger" className="min-w-0 grow basis-[360px] scroll-mt-6">
                <h2 className="text-[15px] font-semibold">{t("danger")}</h2>
                <p className="mt-1 text-[12.5px] text-muted">{t("dangerHint")}</p>
              </div>
              <Button
                onClick={() =>
                  act(async () => {
                    await api.updateWorkspace(workspaceId, { archived: !ws.archived });
                    await refreshWorkspaces();
                    if (!ws.archived) router.push("/");
                  })
                }
              >
                {ws.archived ? t("unarchive") : t("archive")}
              </Button>
              <Button
                variant="danger"
                onClick={() =>
                  window.confirm(t("deleteConfirm", { name: ws.name })) &&
                  act(async () => {
                    await api.removeWorkspace(workspaceId);
                    await Promise.all([refreshWorkspaces(), refreshRepos(), refreshCrews()]);
                    router.push("/");
                  })
                }
              >
                {t("delete")}
              </Button>
            </Card>
          </div>
        </main>
      </div>
    </WorkspaceScope>
  );
}

function SettingToggle({ on, onChange, title, hint, disabled }: { on: boolean; onChange: (v: boolean) => void; title: string; hint: string; disabled?: boolean }) {
  return (
    <div className="flex items-start gap-3 border-t border-border py-3">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={title}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={cn(
          "relative mt-0.5 h-[21px] w-9 flex-none rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50",
          on ? "bg-accent" : "bg-border-strong",
        )}
      >
        <span className={cn("absolute top-0.5 size-[17px] rounded-full bg-bg transition-all", on ? "right-0.5" : "left-0.5")} />
      </button>
      <div>
        <div className="text-[13.5px] font-medium">{title}</div>
        <div className="text-[12.5px] text-muted">{hint}</div>
      </div>
    </div>
  );
}

/** A browser setting (not per workspace): system notifications when an agent needs you. */
function NotifyToggle() {
  const t = useTranslations("wsSettings");
  const { notify, setNotify } = useAppState();
  const unsupported = typeof window !== "undefined" && !("Notification" in window);
  async function change(v: boolean) {
    if (v && Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") return;
    setNotify(v);
  }
  return <SettingToggle on={notify} onChange={(v) => void change(v)} title={t("notify")} hint={unsupported ? t("notifyUnsupported") : t("notifyHint")} disabled={unsupported} />;
}
