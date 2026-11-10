"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";
import type { CheckCommand } from "@forgeboard/shared";
import { api } from "@/lib/api";
import { useAppState } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { RepoSwitcher } from "./top-bar";
import { Button, Card, SectionLabel } from "./ui";

function ChecksEditor() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { selectedRepo, refreshRepos } = useAppState();
  const [rows, setRows] = useState<CheckCommand[]>([]);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setRows(selectedRepo?.checks ?? []), [selectedRepo]);
  if (!selectedRepo) return null;

  const dirty = JSON.stringify(rows) !== JSON.stringify(selectedRepo.checks);
  const valid = rows.every((r) => r.name.trim() && r.command.trim());

  async function save() {
    setState("saving");
    setError(null);
    try {
      await api.setChecks(selectedRepo!.id, rows.map((r) => ({ name: r.name.trim(), command: r.command.trim() })));
      await refreshRepos();
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div>
        <h2 className="text-[15px] font-semibold">{t("checks", { repo: selectedRepo.name })}</h2>
        <p className="mt-0.5 text-[13px] text-muted">{t("checksHint")}</p>
      </div>
      <div className="grid grid-cols-[140px_minmax(0,1fr)_32px] gap-2 text-xs text-muted">
        <span>{t("checkName")}</span>
        <span>{t("checkCommand")}</span>
        <span />
      </div>
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[140px_minmax(0,1fr)_32px] gap-2">
          <input
            aria-label={t("checkName")}
            value={row.name}
            onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
            className="h-[34px] rounded-lg border border-border bg-bg px-2.5 text-[13px] outline-none focus:border-border-strong"
          />
          <input
            aria-label={t("checkCommand")}
            value={row.command}
            onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, command: e.target.value } : r)))}
            className="h-[34px] rounded-lg border border-border bg-bg px-2.5 font-mono text-[12.5px] outline-none focus:border-border-strong"
          />
          <button
            type="button"
            aria-label={`${tc("delete")} ${row.name}`}
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
            className="grid size-[34px] place-items-center rounded-lg text-muted hover:text-danger"
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
    </Card>
  );
}

export function SettingsView() {
  const t = useTranslations("settings");
  const { repos, providers, refreshRepos } = useAppState();

  async function remove(id: string) {
    await api.removeRepo(id);
    await refreshRepos();
  }

  return (
    <main className="flex justify-center px-8 py-7">
      <div className="flex w-full max-w-[860px] flex-col gap-6">
        <h1 className="text-[22px] font-semibold">{t("title")}</h1>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <SectionLabel>{t("repos").toUpperCase()}</SectionLabel>
            <RepoSwitcher />
          </div>
          <Card className="divide-y divide-border">
            {repos.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3 text-[13px]">
                <span className="font-medium">{r.name}</span>
                <span className="min-w-0 truncate font-mono text-xs text-muted">{r.path}</span>
                <Button variant="ghost" className="ml-auto hover:text-danger" onClick={() => remove(r.id)}>
                  {t("remove")}
                </Button>
              </div>
            ))}
          </Card>
        </section>

        <ChecksEditor />

        <section className="flex flex-col gap-3">
          <SectionLabel>{t("providers").toUpperCase()}</SectionLabel>
          <Card className="divide-y divide-border">
            {providers.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3 text-[13px]">
                <span className={cn("size-2 rounded-full", p.available ? "bg-success" : "bg-danger")} aria-hidden="true" />
                <span className="font-medium">{p.label}</span>
                <span className="min-w-0 truncate text-xs text-muted">{p.detail}</span>
                <span className={cn("ml-auto text-xs", p.available ? "text-success" : "text-danger")}>{p.available ? t("available") : t("missing")}</span>
              </div>
            ))}
          </Card>
        </section>
      </div>
    </main>
  );
}
