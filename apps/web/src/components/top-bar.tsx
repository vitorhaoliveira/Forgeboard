"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, Folder, Loader2, Plus, Sparkles } from "lucide-react";
import type { Locale } from "@forgeboard/shared";
import { isActive } from "@forgeboard/shared";
import { api } from "@/lib/api";
import { useAppState } from "@/lib/app-state";
import { cn, formatCost } from "@/lib/utils";
import { Button, Kbd } from "./ui";

export function RepoSwitcher() {
  const t = useTranslations("repo");
  const { repos, selectedRepo, selectRepo } = useAppState();
  const [adding, setAdding] = useState(false);

  return (
    <div className="relative flex items-center gap-1.5">
      <label className="relative flex h-[38px] items-center gap-2 rounded-[9px] border border-border bg-panel pr-2 pl-3">
        <span className="sr-only">{t("switch")}</span>
        <Folder className="size-[15px] text-muted" aria-hidden="true" />
        <select
          value={selectedRepo?.id ?? ""}
          onChange={(e) => selectRepo(e.target.value)}
          disabled={repos.length === 0}
          className="appearance-none bg-transparent pr-5 text-sm font-medium outline-none"
        >
          {repos.length === 0 && <option value="">—</option>}
          {repos.map((r) => (
            <option key={r.id} value={r.id} className="bg-panel">
              {r.name}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-muted" aria-hidden="true" />
      </label>
      <button
        type="button"
        onClick={() => setAdding((v) => !v)}
        aria-label={t("add")}
        title={t("add")}
        aria-expanded={adding}
        className="grid size-[38px] place-items-center rounded-[9px] border border-border bg-panel text-muted hover:text-text"
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>
      {adding && <AddRepoPopover onDone={() => setAdding(false)} />}
    </div>
  );
}

function AddRepoPopover({ onDone }: { onDone: () => void }) {
  const t = useTranslations("repo");
  const tc = useTranslations("common");
  const { addRepo } = useAppState();
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await addRepo(path);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="absolute top-12 left-0 z-20 w-[380px] space-y-2 rounded-xl border border-border-strong bg-panel p-3 shadow-2xl">
      <label className="block text-xs font-medium text-muted" htmlFor="repo-path">
        {t("add")}
      </label>
      <input
        id="repo-path"
        autoFocus
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder={t("addPlaceholder")}
        className="h-9 w-full rounded-lg border border-border bg-bg px-3 font-mono text-[12.5px] outline-none focus:border-border-strong"
      />
      <p className="text-xs text-muted">{t("addHint")}</p>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          {tc("cancel")}
        </Button>
        <Button variant="primary" type="submit" disabled={!path.trim() || busy}>
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          {tc("add")}
        </Button>
      </div>
    </form>
  );
}

export function Composer({ className }: { className?: string }) {
  const t = useTranslations("composer");
  const router = useRouter();
  const locale = useLocale() as Locale;
  const { selectedRepo, refreshTasks } = useAppState();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!selectedRepo || !prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const task = await api.createTask({ repoId: selectedRepo.id, prompt: prompt.trim(), locale });
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
          disabled={!selectedRepo}
          placeholder={selectedRepo ? t("placeholder") : t("needsRepo")}
          className="max-h-32 min-w-0 grow resize-none bg-transparent py-1.5 leading-6 outline-none placeholder:text-muted [field-sizing:content]"
        />
        {prompt.trim() ? (
          <Button variant="primary" type="submit" disabled={busy} className="h-8">
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

export function TopBar() {
  const t = useTranslations("common");
  const locale = useLocale();
  const { tasks } = useAppState();
  const running = tasks.filter((x) => isActive(x.status)).length;
  const today = new Date().toDateString();
  const costToday = tasks.filter((x) => new Date(x.createdAt).toDateString() === today).reduce((s, x) => s + x.costUsd, 0);

  return (
    <header className="flex flex-wrap items-center gap-3.5 border-b border-border px-7 py-3.5">
      <RepoSwitcher />
      <Composer className="mx-auto min-w-[280px] max-w-[680px] grow basis-[380px]" />
      <span className="flex items-center gap-2.5 text-[12.5px] text-muted">
        {running > 0 && (
          <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-info/35 px-2.5 text-info">
            <span className="size-[7px] rounded-full bg-info" aria-hidden="true" />
            {t("running", { count: running })}
          </span>
        )}
        <span className="font-mono">{t("costToday", { cost: formatCost(costToday, locale) })}</span>
      </span>
    </header>
  );
}
