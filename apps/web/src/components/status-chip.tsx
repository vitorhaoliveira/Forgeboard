"use client";

import { useTranslations } from "next-intl";
import type { TaskStatus } from "@forgeboard/shared";
import { useAcceptWords } from "@/lib/app-state";
import { cn } from "@/lib/utils";

const tone: Record<TaskStatus, { text: string; dot: string }> = {
  queued: { text: "text-muted border-border", dot: "bg-muted" },
  running: { text: "text-info border-info/35", dot: "bg-info animate-pulse" },
  waiting: { text: "text-accent border-accent/45", dot: "bg-accent" },
  review: { text: "text-accent border-accent/45", dot: "bg-accent" },
  merged: { text: "text-success border-success/35", dot: "bg-success" },
  discarded: { text: "text-muted border-border", dot: "bg-muted" },
  cancelled: { text: "text-warning border-warning/40", dot: "bg-warning" },
  error: { text: "text-danger border-danger/40", dot: "bg-danger" },
};

export function StatusDot({ status, className }: { status: TaskStatus; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-[7px] shrink-0 rounded-full", tone[status].dot, className)} />;
}

export function StatusChip({ status, workspaceId, children }: { status: TaskStatus; workspaceId?: string; children?: React.ReactNode }) {
  const t = useTranslations("status");
  const accept = useAcceptWords(workspaceId);
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border bg-panel-2 px-2.5 text-xs", tone[status].text)}>
      <StatusDot status={status} />
      {status === "merged" && accept ? t("accepted") : t(status)}
      {children}
    </span>
  );
}
