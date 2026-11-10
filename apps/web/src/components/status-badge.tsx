import type { TaskStatus } from "@forgeboard/shared";
import { cn } from "@/lib/utils";

const styles: Record<TaskStatus, { label: string; dot: string; text: string }> = {
  queued: { label: "Queued", dot: "bg-muted", text: "text-muted" },
  running: { label: "Running", dot: "bg-info animate-pulse", text: "text-info" },
  done: { label: "Done", dot: "bg-success", text: "text-success" },
  error: { label: "Error", dot: "bg-danger", text: "text-danger" },
  cancelled: { label: "Cancelled", dot: "bg-warning", text: "text-warning" },
};

export function StatusDot({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <span
      aria-label={styles[status].label}
      className={cn("inline-block size-2 shrink-0 rounded-full", styles[status].dot, className)}
    />
  );
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const s = styles[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-panel-2 px-2 py-0.5 text-xs font-medium",
        s.text,
      )}
    >
      <StatusDot status={status} />
      {s.label}
    </span>
  );
}
