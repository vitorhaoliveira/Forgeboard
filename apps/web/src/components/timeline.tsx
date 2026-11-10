"use client";

import { useState } from "react";
import Markdown from "react-markdown";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  FileText,
  FilePen,
  Globe,
  ListTodo,
  Loader2,
  Search,
  SquareTerminal,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { RunEvent } from "@forgeboard/shared";
import { cn, formatCost, formatDuration } from "@/lib/utils";

type ToolUse = Extract<RunEvent, { type: "tool_use" }>;
type ToolResult = Extract<RunEvent, { type: "tool_result" }>;

export type TimelineItem =
  | { kind: "text"; key: string; text: string }
  | { kind: "tool"; key: string; use: ToolUse; result?: ToolResult }
  | { kind: "result"; key: string; event: Extract<RunEvent, { type: "result" }> }
  | { kind: "error"; key: string; message: string };

/** Pairs each tool call with its result so they render as one card. */
export function buildTimeline(events: RunEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const toolIndex = new Map<string, number>();

  for (const e of events) {
    const key = String(e.seq);
    if (e.type === "text") items.push({ kind: "text", key, text: e.text });
    else if (e.type === "tool_use") {
      toolIndex.set(e.toolUseId, items.length);
      items.push({ kind: "tool", key, use: e });
    } else if (e.type === "tool_result") {
      const idx = toolIndex.get(e.toolUseId);
      const item = idx === undefined ? undefined : items[idx];
      if (item?.kind === "tool") item.result = e;
    } else if (e.type === "result") {
      // Claude Code repeats its last message as the summary; don't show it twice.
      const last = items.at(-1);
      const repeated = last?.kind === "text" && last.text.trim() === e.summary.trim();
      items.push({ kind: "result", key, event: repeated ? { ...e, summary: "" } : e });
    }
    else if (e.type === "error") items.push({ kind: "error", key, message: e.message });
  }
  return items;
}

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

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** One-line description of what a tool call does, e.g. the file or command. */
function toolSummary(use: ToolUse, repoPath?: string): string {
  const input = use.input;
  const relative = (p?: string) => (p && repoPath && p.startsWith(repoPath) ? p.slice(repoPath.length + 1) : p);
  const summary =
    relative(str(input.file_path)) ??
    str(input.command) ??
    str(input.pattern) ??
    str(input.url) ??
    str(input.query) ??
    str(input.description);
  if (summary) return summary;
  if (use.name === "TodoWrite" && Array.isArray(input.todos)) return `${input.todos.length} todos`;
  return JSON.stringify(input).slice(0, 120);
}

function AgentMessage({ text }: { text: string }) {
  return (
    <div className="flex gap-3">
      <div className="grid size-7 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
        <Bot className="size-4" />
      </div>
      <div className="md min-w-0 flex-1 pt-0.5 text-sm leading-relaxed">
        <Markdown>{text}</Markdown>
      </div>
    </div>
  );
}

function ToolCall({ use, result, repoPath, live }: { use: ToolUse; result?: ToolResult; repoPath?: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  const Icon = toolIcons[use.name] ?? Wrench;
  const pending = !result && live;

  return (
    <div className="ml-10 overflow-hidden rounded-lg border border-border bg-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-panel-2"
      >
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted transition", open && "rotate-90")} />
        <Icon className="size-3.5 shrink-0 text-muted" />
        <span className="font-medium">{use.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-muted">{toolSummary(use, repoPath)}</span>
        {pending && <Loader2 className="size-3.5 shrink-0 animate-spin text-info" />}
        {result && !result.isError && <CheckCircle2 className="size-3.5 shrink-0 text-success" />}
        {result?.isError && <XCircle className="size-3.5 shrink-0 text-danger" />}
      </button>
      {open && (
        <div className="space-y-2 border-t border-border bg-panel-2/50 p-3">
          <pre className="overflow-x-auto font-mono text-[11px] text-muted">{JSON.stringify(use.input, null, 2)}</pre>
          {result && (
            <pre
              className={cn(
                "max-h-80 overflow-auto rounded border border-border bg-bg p-2 font-mono text-[11px] whitespace-pre-wrap",
                result.isError && "text-danger",
              )}
            >
              {result.output || "(no output)"}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function ResultCard({ event }: { event: Extract<RunEvent, { type: "result" }> }) {
  return (
    <div className="rounded-lg border border-success/30 bg-success/5 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-success">
        <CheckCircle2 className="size-4" /> Finished
        <span className="ml-auto font-mono text-xs font-normal text-muted">
          {formatDuration(event.durationMs)} · {formatCost(event.costUsd)}
        </span>
      </div>
      {event.summary && (
        <div className="md text-sm leading-relaxed">
          <Markdown>{event.summary}</Markdown>
        </div>
      )}
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="flex gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <pre className="min-w-0 flex-1 font-sans whitespace-pre-wrap">{message}</pre>
    </div>
  );
}

export function Timeline({ items, repoPath, live }: { items: TimelineItem[]; repoPath?: string; live: boolean }) {
  return (
    <ol className="space-y-3">
      {items.map((item) => (
        <li key={item.key}>
          {item.kind === "text" && <AgentMessage text={item.text} />}
          {item.kind === "tool" && <ToolCall use={item.use} result={item.result} repoPath={repoPath} live={live} />}
          {item.kind === "result" && <ResultCard event={item.event} />}
          {item.kind === "error" && <ErrorCard message={item.message} />}
        </li>
      ))}
    </ol>
  );
}
