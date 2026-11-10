"use client";

import { useTranslations } from "next-intl";
import type { Actor } from "@forgeboard/shared";
import { useAppState, useWorkspaceScope } from "@/lib/app-state";
import { cn } from "@/lib/utils";

/** Agent identity lives in the letter color only; the block stays neutral. */
export const ACTOR_COLOR: Record<Actor, string> = {
  forge: "text-accent",
  hawk: "text-info",
  checks: "text-muted",
  you: "text-violet",
  system: "text-muted",
};

/** Agent names follow the crew of the surrounding workspace (see WorkspaceScope). */
export function useActorName(workspaceId?: string) {
  const { agentName } = useAppState();
  const scope = useWorkspaceScope();
  const t = useTranslations("actors");
  return (actor: Actor) => (actor === "forge" || actor === "hawk" ? agentName(actor, workspaceId ?? scope) : t(actor));
}

export function Glyph({ actor, size = 26, className, ring }: { actor: Actor; size?: number; className?: string; ring?: boolean }) {
  const name = useActorName()(actor);
  const letter = actor === "checks" ? "✓" : actor === "system" ? "·" : (name[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-lg bg-glyph font-bold",
        ACTOR_COLOR[actor],
        ring && "ring-2 ring-current",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}
    >
      {letter}
    </span>
  );
}
