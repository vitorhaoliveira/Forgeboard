"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, X } from "lucide-react";
import { WORKSPACE_COLORS, type WorkspaceColor } from "@forgeboard/shared";
import { api } from "@/lib/api";
import { useAppState } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { Button, SectionLabel } from "./ui";
import { WorkspaceTile, WS_BG } from "./workspace-ui";

export function ColorPicker({ value, onChange, label }: { value: WorkspaceColor; onChange: (c: WorkspaceColor) => void; label: string }) {
  const t = useTranslations("newWs");
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-2.5">
      {WORKSPACE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={t(`colors.${c}`)}
          onClick={() => onChange(c)}
          className={cn("size-6 rounded-lg", WS_BG[c], value === c && "ring-2 ring-current ring-offset-2 ring-offset-panel")}
          style={value === c ? { color: `var(--${c})` } : undefined}
        />
      ))}
    </div>
  );
}

/** Dialog for creating a workspace: name, color, repositories and crew. */
export function NewWorkspaceDialog() {
  const t = useTranslations("newWs");
  const tc = useTranslations("common");
  const router = useRouter();
  const { newWorkspaceOpen, setNewWorkspaceOpen, activeWorkspaces, refreshWorkspaces, refreshRepos, refreshCrews } = useAppState();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<WorkspaceColor>("info");
  const [path, setPath] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [crewFrom, setCrewFrom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (newWorkspaceOpen && !dialog.open) {
      setName("");
      setDescription("");
      setColor(WORKSPACE_COLORS[activeWorkspaces.length % WORKSPACE_COLORS.length]!);
      setPath("");
      setPaths([]);
      setCrewFrom(null);
      setError(null);
      dialog.showModal();
    } else if (!newWorkspaceOpen && dialog.open) {
      dialog.close();
    }
  }, [newWorkspaceOpen, activeWorkspaces.length]);

  function addPath() {
    const p = path.trim();
    if (p && !paths.includes(p)) setPaths([...paths, p]);
    setPath("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const allPaths = path.trim() && !paths.includes(path.trim()) ? [...paths, path.trim()] : paths;
    setBusy(true);
    setError(null);
    try {
      const ws = await api.createWorkspace({ name: name.trim(), description: description.trim(), color, crewFrom, repoPaths: allPaths });
      await Promise.all([refreshWorkspaces(), refreshRepos(), refreshCrews()]);
      setNewWorkspaceOpen(false);
      router.push(`/w/${ws.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const copyable = activeWorkspaces;

  return (
    <dialog
      ref={dialogRef}
      onClose={() => setNewWorkspaceOpen(false)}
      aria-labelledby="new-ws-title"
      className="m-auto w-[min(640px,calc(100vw-32px))] rounded-[18px] border border-border-strong bg-panel p-0 text-text shadow-[0_30px_80px_rgba(0,0,0,.6)] backdrop:bg-black/60"
    >
      <form onSubmit={submit} className="flex flex-col">
        <div className="flex items-center gap-3 px-[22px] pt-5">
          <h1 id="new-ws-title" className="text-lg font-semibold">
            {t("title")}
          </h1>
          <button type="button" onClick={() => setNewWorkspaceOpen(false)} aria-label={t("close")} className="ml-auto grid size-8 place-items-center rounded-lg text-muted hover:text-text">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-5 px-[22px] py-[18px]">
          <div className="flex flex-wrap items-end gap-3.5">
            <WorkspaceTile workspace={{ name: name || "?", color }} size={52} />
            <label className="flex grow basis-[180px] flex-col gap-1.5">
              <span className="text-xs text-muted">{t("name")}</span>
              <input
                autoFocus
                required
                maxLength={40}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("namePlaceholder")}
                className="h-[38px] rounded-[9px] border border-border bg-bg px-3 outline-none focus:border-border-strong"
              />
            </label>
            <label className="flex grow basis-[160px] flex-col gap-1.5">
              <span className="text-xs text-muted">{t("description")}</span>
              <input
                maxLength={80}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("descriptionPlaceholder")}
                className="h-[38px] rounded-[9px] border border-border bg-bg px-3 outline-none focus:border-border-strong"
              />
            </label>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted">{t("color")}</span>
            <ColorPicker value={color} onChange={setColor} label={t("color")} />
          </div>

          <div className="flex flex-col gap-2">
            <SectionLabel>{t("repos")}</SectionLabel>
            <div className="flex gap-2">
              <label htmlFor="new-ws-path" className="sr-only">
                {t("repoPlaceholder")}
              </label>
              <input
                id="new-ws-path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addPath();
                  }
                }}
                placeholder={t("repoPlaceholder")}
                className="h-[38px] min-w-0 grow rounded-[9px] border border-border bg-bg px-3 font-mono text-[12.5px] outline-none focus:border-border-strong"
              />
              <Button onClick={addPath} disabled={!path.trim()} className="h-[38px]">
                {t("add")}
              </Button>
            </div>
            {paths.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {paths.map((p) => (
                  <span key={p} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-panel-2 px-2.5 font-mono text-xs">
                    {p.split("/").filter(Boolean).at(-1)}
                    <button type="button" aria-label={t("remove", { name: p })} onClick={() => setPaths(paths.filter((x) => x !== p))} className="text-muted hover:text-text">
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-muted">{t("reposHint")}</p>
          </div>

          <div className="flex flex-col gap-2">
            <SectionLabel>{t("crew")}</SectionLabel>
            <div role="radiogroup" aria-label={t("crew")} className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <button
                type="button"
                role="radio"
                aria-checked={crewFrom === null}
                onClick={() => setCrewFrom(null)}
                className={cn("flex flex-col gap-1 rounded-[10px] border px-3.5 py-3 text-left", crewFrom === null ? "border-border-strong bg-panel-2" : "border-border")}
              >
                <span className="flex items-center gap-2 font-medium">
                  {t("crewDefault")}
                  {crewFrom === null && <Check className="ml-auto size-3.5" aria-hidden="true" />}
                </span>
                <span className="text-[12.5px] text-muted">{t("crewDefaultHint")}</span>
              </button>
              <div
                className={cn("flex flex-col gap-1.5 rounded-[10px] border px-3.5 py-3 text-left", crewFrom !== null ? "border-border-strong bg-panel-2" : "border-border", copyable.length === 0 && "opacity-50")}
              >
                <span className="font-medium">{t("crewCopy")}</span>
                <span className="text-[12.5px] text-muted">{t("crewCopyHint")}</span>
                <select
                  aria-label={t("crewCopy")}
                  disabled={copyable.length === 0}
                  value={crewFrom ?? ""}
                  onChange={(e) => setCrewFrom(e.target.value || null)}
                  className="mt-1 h-8 rounded-md border border-border bg-bg px-2 text-[12.5px] outline-none"
                >
                  <option value="">—</option>
                  {copyable.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted">{t("rulesHint")}</p>
          {error && <p className="text-[13px] text-danger">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-[22px] py-3.5">
          <Button onClick={() => setNewWorkspaceOpen(false)}>{tc("cancel")}</Button>
          <Button type="submit" variant="primary" disabled={!name.trim() || busy}>
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
            {t("create")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
