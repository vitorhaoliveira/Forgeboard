"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, FilePen, Loader2, Square } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { api } from "@/lib/api";
import { useTaskStream } from "@/lib/use-task-stream";
import { formatCost, formatDuration } from "@/lib/utils";
import { StatusBadge } from "./status-badge";
import { buildTimeline, Timeline } from "./timeline";
import { Button } from "./ui";

export function TaskView({ taskId }: { taskId: string }) {
  const { task, events, error } = useTaskStream(taskId);
  const { repos, providers, refreshTasks } = useAppState();
  const [cancelling, setCancelling] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const items = useMemo(() => buildTimeline(events), [events]);
  const repo = repos.find((r) => r.id === task?.repoId);
  const live = task?.status === "running" || task?.status === "queued";

  // Update the sidebar as soon as the run finishes.
  const status = task?.status;
  useEffect(() => {
    if (status && !live) void refreshTasks();
  }, [status, live, refreshTasks]);

  // Follow new events, unless the user scrolled up to read something.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  function onScroll() {
    const el = scrollRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function cancel() {
    setCancelling(true);
    try {
      await api.cancelTask(taskId);
      void refreshTasks();
    } finally {
      setCancelling(false);
    }
  }

  if (error) return <p className="p-8 text-sm text-danger">{error}</p>;
  if (!task) {
    return (
      <div className="grid h-full place-items-center text-muted">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  const providerLabel = providers.find((p) => p.id === task.provider)?.label ?? task.provider;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-base font-semibold">{task.title}</h1>
            <StatusBadge status={task.status} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span>{providerLabel}</span>
            <span className="inline-flex items-center gap-1">
              {task.permissionMode === "plan" ? <Eye className="size-3" /> : <FilePen className="size-3" />}
              {task.permissionMode === "plan" ? "Read only" : "Can edit files"}
            </span>
            {repo && <span className="font-mono">{repo.name}</span>}
            <span className="font-mono" title="Cost is the API-equivalent estimate reported by the agent">
              {formatDuration(task.durationMs)} · {formatCost(task.costUsd)}
            </span>
          </div>
        </div>
        {live && (
          <Button variant="danger" onClick={cancel} disabled={cancelling}>
            {cancelling ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
            Stop
          </Button>
        )}
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-6 py-6">
          <div className="rounded-lg border border-border bg-panel-2 px-4 py-3">
            <p className="mb-1 text-[11px] font-medium tracking-wide text-muted uppercase">Task</p>
            <p className="text-sm whitespace-pre-wrap">{task.prompt}</p>
          </div>

          <Timeline items={items} repoPath={repo?.path} live={live} />

          {live && (
            <div className="ml-10 flex items-center gap-2 text-xs text-muted" aria-live="polite">
              <Loader2 className="size-3.5 animate-spin" /> Agent is working…
            </div>
          )}
          {task.status === "cancelled" && <p className="text-center text-xs text-warning">Stopped by you.</p>}
        </div>
      </div>
    </div>
  );
}
