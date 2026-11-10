"use client";

import type { Workspace, WorkspaceColor } from "@forgeboard/shared";
import { cn } from "@/lib/utils";

export const WS_TEXT: Record<WorkspaceColor, string> = {
  info: "text-info",
  success: "text-success",
  violet: "text-violet",
  pink: "text-pink",
  warning: "text-warning",
};

export const WS_BG: Record<WorkspaceColor, string> = {
  info: "bg-info",
  success: "bg-success",
  violet: "bg-violet",
  pink: "bg-pink",
  warning: "bg-warning",
};

export function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

export function WorkspaceTile({ workspace, size = 30, className }: { workspace: Pick<Workspace, "name" | "color">; size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("grid shrink-0 place-items-center bg-glyph font-bold", WS_TEXT[workspace.color], className)}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), fontSize: Math.round(size * 0.44) }}
    >
      {initial(workspace.name)}
    </span>
  );
}

export function WorkspaceDot({ color, className }: { color: WorkspaceColor; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-[3px]", WS_BG[color], className)} />;
}
