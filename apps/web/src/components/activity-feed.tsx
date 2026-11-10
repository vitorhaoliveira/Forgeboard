"use client";

import { useState } from "react";
import Markdown from "react-markdown";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  FilePen,
  FileText,
  Globe,
  ListTodo,
  Loader2,
  Search,
  SquareTerminal,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { Actor, CheckResult, RunEvent, Verdict } from "@forgeboard/shared";
import { cleanAgentText } from "@/lib/run-model";
import { cn, formatDuration, relativePath } from "@/lib/utils";
import { Glyph, useActorName } from "./glyph";
import { Chip } from "./ui";

type ToolUse = Extract<RunEvent, { type: "tool_use" }>;
type ToolResult = Extract<RunEvent, { type: "tool_result" }>;

type Item =
  | { kind: "event"; key: string; event: RunEvent }
  | { kind: "tool"; key: string; use: ToolUse; result?: ToolResult };

const toolIcons: Record<string, LucideIcon> = {
  Read: FileText,
  Edit: FilePen,
  MultiEdit: FilePen,
  Write: FilePen,
  Bash: SquareTerminal,
  Glob: Search,
  Grep: Search,
  WebFetch: Globe,
  WebSearch: Globe,
  TodoWrite: ListTodo,
};

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

function toolSummary(use: ToolUse): string {
  const i = use.input;
  const path = str(i.file_path) ?? str(i.path);
  const summary = (path && relativePath(path)) ?? str(i.command) ?? str(i.pattern) ?? str(i.url) ?? str(i.query) ?? str(i.description);
  if (summary) return summary;
  if (Array.isArray(i.todos)) return `${i.todos.length} todos`;
  return JSON.stringify(i).slice(0, 100);
}

/** Pairs tool calls with results and drops events that would only repeat something. */
function buildItems(events: RunEvent[], filter: Actor | null): Item[] {
  const items: Item[] = [];
  const toolIndex = new Map<string, number>();
  let lastText: Partial<Record<Actor, string>> = {};

  for (const e of events) {
    const key = String(e.seq);
    if (e.type === "node" || e.type === "status") continue;
    if (filter && e.type !== "round" && e.actor !== filter) continue;

    if (e.type === "tool_use") {
      toolIndex.set(e.toolUseId, items.length);
      items.push({ kind: "tool", key, use: e });
    } else if (e.type === "tool_result") {
      const idx = toolIndex.get(e.toolUseId);
      const item = idx === undefined ? undefined : items[idx];
      if (item?.kind === "tool") item.result = e;
    } else if (e.type === "text") {
      const clean = e.actor === "you" ? e.text : cleanAgentText(e.text);
      if (!clean) continue;
      lastText[e.actor] = clean;
      items.push({ kind: "event", key, event: { ...e, text: clean } });
    } else if (e.type === "step_done") {
      // Claude Code also streams its final message as text; skip the copy.
      const clean = cleanAgentText(e.summary);
      if (!clean || lastText[e.actor] === clean) continue;
      items.push({ kind: "event", key, event: { ...e, summary: clean } });
    } else {
      if (e.type === "round") lastText = {};
      items.push({ kind: "event", key, event: e });
    }
  }
  return items;
}

function ToolLine({ use, result, live }: { use: ToolUse; result?: ToolResult; live: boolean }) {
  const [open, setOpen] = useState(false);
  const Icon = toolIcons[use.name] ?? Wrench;
  return (
    <div className="ml-9 overflow-hidden rounded-lg border border-border bg-panel">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 px-2.5 py-[7px] text-left text-[12.5px] hover:bg-panel-2">
        <ChevronRight className={cn("size-3 shrink-0 text-muted transition", open && "rotate-90")} aria-hidden="true" />
        <Icon className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
        <span className="font-medium">{use.name}</span>
        <span className="min-w-0 grow truncate font-mono text-muted">{toolSummary(use)}</span>
        {!result && live && <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" aria-hidden="true" />}
        {result && !result.isError && <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden="true" />}
        {result?.isError && <XCircle className="size-3.5 shrink-0 text-danger" aria-hidden="true" />}
      </button>
      {open && (
        <div className="space-y-2 border-t border-border bg-bg/50 p-2.5">
          <pre className="overflow-x-auto font-mono text-[11px] text-muted">{JSON.stringify(use.input, null, 2)}</pre>
          {result && (
            <pre className={cn("max-h-72 overflow-auto rounded border border-border bg-bg p-2 font-mono text-[11px] whitespace-pre-wrap", result.isError && "text-danger")}>
              {result.output || "—"}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function ChecksBlock({ results }: { results: CheckResult[] }) {
  const t = useTranslations("run");
  const failed = results.filter((r) => !r.ok);
  if (results.length === 0) return <p className="text-[12.5px] text-muted">{t("noChecks")}</p>;
  return (
    <div className="rounded-lg border border-border bg-panel">
      <div className={cn("px-3 py-2 text-[12.5px] font-medium", failed.length ? "text-danger" : "text-success")}>
        {failed.length ? t("checksFailed", { count: failed.length }) : t("checksAllPassed")}
      </div>
      {results.map((r) => (
        <details key={r.name} className="border-t border-border" open={!r.ok}>
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-[7px] text-[12.5px]">
            {r.ok ? <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" /> : <XCircle className="size-3.5 text-danger" aria-hidden="true" />}
            <span className="font-medium">{r.name}</span>
            <span className="min-w-0 truncate font-mono text-muted">{r.command}</span>
            <span className="ml-auto font-mono text-[11px] text-muted">{formatDuration(r.durationMs)}</span>
          </summary>
          {r.output && <pre className="max-h-56 overflow-auto border-t border-border bg-bg p-2.5 font-mono text-[11px] whitespace-pre-wrap text-muted">{r.output}</pre>}
        </details>
      ))}
    </div>
  );
}

export function VerdictBlock({ verdict }: { verdict: Verdict }) {
  const t = useTranslations("run");
  const sev = { high: "bg-danger", medium: "bg-warning", low: "bg-muted" } as const;
  return (
    <div className={cn("overflow-hidden rounded-[10px] border bg-panel", verdict.approved ? "border-success/30" : "border-warning/35")}>
      <div className={cn("flex items-center gap-2 px-3.5 py-2.5", verdict.approved ? "bg-success/5" : "bg-warning/5")}>
        {verdict.approved ? <CheckCircle2 className="size-4 text-success" aria-hidden="true" /> : <AlertTriangle className="size-4 text-warning" aria-hidden="true" />}
        <span className={cn("font-semibold", verdict.approved ? "text-success" : "text-warning")}>{verdict.approved ? t("approved") : t("changesRequested")}</span>
      </div>
      {verdict.summary && <p className="border-t border-border px-3.5 py-2.5 text-[13px]">{verdict.summary}</p>}
      {verdict.issues.length > 0 && (
        <ol className="border-t border-border">
          {verdict.issues.map((issue, i) => (
            <li key={i} className="flex items-start gap-2.5 border-t border-border px-3.5 py-2.5 first:border-t-0">
              <span className={cn("mt-0.5 rounded px-1.5 font-mono text-[10.5px] font-semibold text-bg uppercase", sev[issue.severity])}>{issue.severity}</span>
              <span className="min-w-0 text-[13px]">
                {issue.message}
                {issue.file && (
                  <span className="block font-mono text-xs text-muted">
                    {issue.file}
                    {issue.line ? `:${issue.line}` : ""}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function EventItem({ event }: { event: RunEvent }) {
  const t = useTranslations("run");
  const tf = useTranslations("flow");
  const name = useActorName();
  const locale = useLocale();
  void locale;

  switch (event.type) {
    case "round":
      return (
        <div className="flex items-center gap-3 py-1 text-[11px] font-medium tracking-[0.05em] text-muted uppercase">
          <span className="h-px grow bg-border" />
          {t("roundDivider", { round: event.round })}
          <span className="h-px grow bg-border" />
        </div>
      );
    case "text":
      return (
        <div className="flex gap-2.5">
          <Glyph actor={event.actor} />
          <div className="min-w-0 grow">
            {event.actor === "you" && <div className="mb-0.5 text-xs text-muted">{t("youSaid")}</div>}
            <div className="md pt-0.5 text-[13.5px] leading-relaxed">
              <Markdown>{event.text}</Markdown>
            </div>
          </div>
        </div>
      );
    case "step_done":
      return (
        <div className="flex gap-2.5">
          <Glyph actor={event.actor} />
          <div className="min-w-0 grow rounded-[10px] border border-border bg-panel px-3 py-2.5">
            <div className="mb-1 text-xs text-muted">{t("done")}</div>
            <div className="md text-[13.5px] leading-relaxed">
              <Markdown>{event.summary}</Markdown>
            </div>
          </div>
        </div>
      );
    case "checks":
      return (
        <div className="flex gap-2.5">
          <Glyph actor="checks" />
          <div className="min-w-0 grow">
            <ChecksBlock results={event.results} />
          </div>
        </div>
      );
    case "verdict":
      return (
        <div className="flex gap-2.5">
          <Glyph actor="hawk" />
          <div className="min-w-0 grow">
            <VerdictBlock verdict={event.verdict} />
          </div>
        </div>
      );
    case "question":
      return (
        <div className="flex gap-2.5">
          <Glyph actor={event.actor} />
          <div className="min-w-0 grow rounded-[10px] border border-accent/45 bg-accent/5 px-3 py-2.5 text-[13.5px]">
            <div className="font-medium">{event.question.question}</div>
            {event.question.context && <div className="mt-0.5 text-[12.5px] text-muted">{event.question.context}</div>}
          </div>
        </div>
      );
    case "answer":
      return (
        <div className="flex gap-2.5">
          <Glyph actor="you" />
          <div className="flex min-w-0 grow flex-wrap items-center gap-1.5 pt-0.5 text-[13px]">
            <span className="text-muted">{t("youAnswered")}:</span>
            <span className="font-medium">{event.text}</span>
            {event.remember && <Chip tone="accent">{t("savedAsRule")}</Chip>}
          </div>
        </div>
      );
    case "handoff":
      return (
        <div className="ml-9 flex items-center gap-2 text-[12.5px] text-muted">
          <ArrowRight className="size-3.5" aria-hidden="true" />
          {event.actor === "hawk" && event.label
            ? tf("issuesTo", { count: Number(event.label), name: name(event.to) })
            : t("handoff", { name: name(event.to) })}
        </div>
      );
    case "merged":
      return (
        <div className="flex items-center gap-2 rounded-[10px] border border-success/30 bg-success/5 px-3 py-2.5 text-[13px] text-success">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          {t("merged", { branch: event.branch })}
        </div>
      );
    case "error":
      return (
        <div className="flex gap-2 rounded-[10px] border border-danger/40 bg-danger/10 p-3 text-[13px] text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <pre className="min-w-0 grow font-sans whitespace-pre-wrap">{event.message}</pre>
        </div>
      );
    default:
      return null;
  }
}

export function ActivityFeed({ events, filter, live }: { events: RunEvent[]; filter: Actor | null; live: boolean }) {
  const t = useTranslations("run");
  const items = buildItems(events, filter);
  if (items.length === 0) return <p className="py-6 text-center text-[13px] text-muted">{t("noActivity")}</p>;
  return (
    <ol className="flex flex-col gap-3.5">
      {items.map((item) => (
        <li key={item.key}>{item.kind === "tool" ? <ToolLine use={item.use} result={item.result} live={live} /> : <EventItem event={item.event} />}</li>
      ))}
    </ol>
  );
}
