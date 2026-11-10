"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, ChevronRight, GitMerge, Loader2, XCircle } from "lucide-react";
import type { DiffFile } from "@forgeboard/shared";
import { api } from "@/lib/api";
import { useAppState, WorkspaceScope } from "@/lib/app-state";
import { cleanAgentText } from "@/lib/run-model";
import { useTaskStream } from "@/lib/use-task-stream";
import { cn, formatCost } from "@/lib/utils";
import { VerdictBlock } from "./activity-feed";
import { Glyph, useActorName } from "./glyph";
import { Button, buttonClass, Card, Chip, SectionLabel } from "./ui";

function DiffLines({ patch }: { patch: string }) {
  const lines = patch.split("\n");
  const start = lines.findIndex((l) => l.startsWith("@@"));
  return (
    <div className="overflow-x-auto rounded-[9px] border border-border bg-bg font-mono text-[12.5px] leading-[23px]">
      {(start === -1 ? [] : lines.slice(start)).map((line, i) => (
        <div
          key={i}
          className={cn(
            "px-3 whitespace-pre",
            line.startsWith("@@") && "bg-info/5 text-info",
            line.startsWith("+") && "bg-success/10",
            line.startsWith("-") && "bg-danger/10",
          )}
        >
          <span className={cn("inline-block w-4 select-none", line.startsWith("+") ? "text-success" : line.startsWith("-") ? "text-danger" : "text-muted")}>
            {line.startsWith("@@") ? "" : line[0] === " " ? "" : line[0]}
          </span>
          {line.startsWith("@@") ? line : line.slice(1)}
        </div>
      ))}
    </div>
  );
}

function FileRow({ file, included, onToggle }: { file: DiffFile; included: boolean; onToggle: () => void }) {
  const t = useTranslations("decide");
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-border first:border-t-0">
      <div className="flex items-center gap-2.5 px-3.5 py-[11px] text-[13px]">
        <input type="checkbox" checked={included} onChange={onToggle} aria-label={file.path} className="accent-accent" />
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 grow items-center gap-2 text-left">
          <ChevronRight className={cn("size-3.5 shrink-0 text-muted transition", open && "rotate-90")} aria-hidden="true" />
          <span className={cn("truncate font-mono", !included && "text-muted line-through")}>{file.path}</span>
          {file.status === "added" && <Chip className="h-5" tone="success">{t("newFile")}</Chip>}
          {file.status === "deleted" && <Chip className="h-5" tone="danger">{t("deletedFile")}</Chip>}
        </button>
        <span className="shrink-0 font-mono text-xs">
          <span className="text-success">+{file.additions}</span> <span className="text-danger">−{file.deletions}</span>
        </span>
      </div>
      {open && (
        <div className="px-3.5 pb-3">
          <DiffLines patch={file.patch} />
        </div>
      )}
    </div>
  );
}

export function DecideView({ taskId }: { taskId: string }) {
  const t = useTranslations("decide");
  const tr = useTranslations("review");
  const ts = useTranslations("status");
  const tf = useTranslations("flow");
  const trun = useTranslations("run");
  const locale = useLocale();
  const router = useRouter();
  const name = useActorName();
  const { refreshTasks } = useAppState();
  const { task } = useTaskStream(taskId);
  const [files, setFiles] = useState<DiffFile[] | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [ruleState, setRuleState] = useState<"idle" | "added" | "dismissed">("idle");
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"merge" | "discard" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.diff(taskId).then(setFiles).catch(() => setFiles([]));
  }, [taskId, task?.round]);

  if (!task) {
    return (
      <div className="grid grow place-items-center text-muted">
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  if (task.status !== "review") {
    return (
      <main className="grid grow place-items-center px-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-muted">{t("notReady", { status: ts(task.status).toLowerCase() })}</p>
          <Link href={`/runs/${task.id}`} className={buttonClass("secondary")}>
            {t("openRun")}
          </Link>
        </div>
      </main>
    );
  }

  const v = task.verdict;
  const checks = task.checks ?? [];
  const includedCount = (files ?? []).filter((f) => !excluded.has(f.path)).length;
  const branch = task.baseBranch ?? "main";

  async function act(kind: "merge" | "discard" | "send") {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "merge") await api.merge(task!.id, [...excluded]);
      if (kind === "discard") await api.discard(task!.id);
      if (kind === "send") await api.sendBack(task!.id, notes.trim());
      await refreshTasks();
      router.push(kind === "send" ? `/runs/${task!.id}` : `/w/${task!.workspaceId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  async function addRule() {
    if (!v?.suggestedRule) return;
    await api.addRule("repo", task!.repoId, v.suggestedRule, "hawk");
    setRuleState("added");
  }

  function toggle(path: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <WorkspaceScope workspaceId={task.workspaceId}>
    <div className="flex min-h-screen grow flex-col">
      <main className="flex grow justify-center px-8 pt-[26px] pb-6">
        <div className="flex w-full max-w-[1080px] flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Link href={`/w/${task.workspaceId}`} className="text-[13px] text-muted hover:text-text">
              {t("back")}
            </Link>
            <div className="flex flex-wrap items-center gap-2.5">
              <Chip tone={v?.approved ? "success" : "warning"}>{v?.approved ? tr("ready") : tr("concerns")}</Chip>
              <span className="text-[12.5px] text-muted">
                {tf("name")} · {tr(v?.approved ? "approvedBy" : "notApproved", { name: name("hawk"), count: task.round })} ·{" "}
                <span className="font-mono">{formatCost(task.costUsd, locale)}</span>
              </span>
            </div>
            <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{task.title}</h1>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3.5">
            <Card className="flex flex-col gap-2.5 p-4">
              <SectionLabel>{t("whatChanged")}</SectionLabel>
              <div className="md text-[13.5px] leading-relaxed">
                <Markdown>{cleanAgentText(task.summary ?? "") || "—"}</Markdown>
              </div>
            </Card>
            <Card className="flex flex-col gap-2.5 p-4">
              <SectionLabel>{t("howWeKnow")}</SectionLabel>
              {checks.length === 0 ? (
                <p className="text-[13px] text-muted">
                  <Link href="/settings" className="underline">
                    {trun("noChecks")}
                  </Link>
                </p>
              ) : (
                <ul className="flex flex-col gap-2 text-[13px]">
                  {checks.map((c) => (
                    <li key={c.name} className="flex items-center gap-2">
                      {c.ok ? <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" /> : <XCircle className="size-3.5 text-danger" aria-hidden="true" />}
                      <span>{c.name}</span>
                      <span className="ml-auto truncate font-mono text-xs text-muted">{c.command}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="flex flex-col gap-2.5 p-4">
              <SectionLabel>{t("risk")}</SectionLabel>
              {v && (
                <div className="flex items-center gap-2.5">
                  <span className={cn("text-xl font-semibold", v.risk === "low" ? "text-success" : v.risk === "high" ? "text-danger" : "text-warning")}>
                    {t("riskLevel", { level: v.risk })}
                  </span>
                  <span className="grid grid-cols-3 gap-[3px]">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className={cn("h-1.5 w-7 rounded-sm bg-panel-2", i <= ["low", "medium", "high"].indexOf(v.risk) && (v.risk === "low" ? "bg-success" : v.risk === "high" ? "bg-danger" : "bg-warning"))}
                      />
                    ))}
                  </span>
                </div>
              )}
              <p className="text-[13px] text-muted">{v?.issues.length ? `${t("issues")}: ${v.issues.length}` : t("noIssues")}</p>
            </Card>
          </div>

          {v && (v.issues.length > 0 || !v.approved) && <VerdictBlock verdict={v} />}

          <section aria-label={t("files")} className="overflow-hidden rounded-2xl border border-border bg-panel">
            <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-3.5 py-3">
              <SectionLabel>{t("files")}</SectionLabel>
              <span className="text-[12.5px] text-muted">{t("filesHint")}</span>
              {files && (
                <span className="ml-auto font-mono text-[12.5px]">
                  <span className="text-success">+{files.reduce((s, f) => s + f.additions, 0)}</span>{" "}
                  <span className="text-danger">−{files.reduce((s, f) => s + f.deletions, 0)}</span>
                </span>
              )}
            </div>
            {files === null ? (
              <div className="p-4 text-muted">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              </div>
            ) : files.length === 0 ? (
              <p className="p-4 text-[13px] text-muted">{t("noFiles")}</p>
            ) : (
              files.map((f) => <FileRow key={f.path} file={f} included={!excluded.has(f.path)} onToggle={() => toggle(f.path)} />)
            )}
          </section>

          {v?.suggestedRule && ruleState !== "dismissed" && (
            <section className="flex flex-wrap items-center gap-3.5 rounded-2xl border border-dashed border-accent/45 bg-accent/[0.04] px-4 py-3.5">
              <Glyph actor="hawk" />
              <div className="min-w-0 grow basis-[360px]">
                <div className="font-medium">{t("teachTitle", { name: name("hawk") })}</div>
                <div className="text-[13px] text-muted">
                  “{v.suggestedRule}” {t("teachBody")}
                </div>
              </div>
              {ruleState === "added" ? (
                <Chip tone="success">{t("ruleAdded")}</Chip>
              ) : (
                <>
                  <Button variant="ghost" onClick={() => setRuleState("dismissed")}>
                    {t("notNow")}
                  </Button>
                  <Button variant="soft" onClick={addRule}>
                    {t("addRule")}
                  </Button>
                </>
              )}
            </section>
          )}

          {notesOpen && (
            <div className="flex flex-col gap-2">
              <label htmlFor="notes" className="sr-only">
                {t("sendBackPlaceholder")}
              </label>
              <textarea
                id="notes"
                autoFocus
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("sendBackPlaceholder")}
                className="w-full resize-y rounded-xl border border-border bg-panel px-3.5 py-3 outline-none focus:border-border-strong"
              />
            </div>
          )}
          {error && <p className="text-[13px] text-danger">{error}</p>}
        </div>
      </main>

      <footer className="sticky bottom-0 flex justify-center border-t border-border bg-panel px-8 py-3">
        <div className="flex w-full max-w-[1080px] flex-wrap items-center gap-2.5">
          <Button variant="ghost" className="text-danger" disabled={busy !== null} onClick={() => window.confirm(t("discardConfirm")) && act("discard")}>
            {t("discard")}
          </Button>
          {notesOpen ? (
            <Button disabled={!notes.trim() || busy !== null} onClick={() => act("send")}>
              {busy === "send" && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
              {t("sendBack")}
            </Button>
          ) : (
            <Button onClick={() => setNotesOpen(true)} disabled={busy !== null}>
              {t("sendBack")}
            </Button>
          )}
          <Button variant="primary" className="ml-auto h-[38px]" disabled={includedCount === 0 || busy !== null} onClick={() => act("merge")}>
            {busy === "merge" ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <GitMerge className="size-4" aria-hidden="true" />}
            {busy === "merge" ? t("merging") : t("merge", { count: includedCount, branch })}
          </Button>
        </div>
      </footer>
    </div>
    </WorkspaceScope>
  );
}
