"use client";

import { useTranslations } from "next-intl";
import { SYSTEM_ACTORS, type Actor, type AgentRole } from "@forgeboard/shared";
import { useAppState, useWorkspaceScope } from "@/lib/app-state";
import { cn } from "@/lib/utils";

/** Agent identity lives in the letter color only; the block stays neutral. */
const FIXED_COLOR: Record<string, string> = {
  forge: "text-accent",
  hawk: "text-info",
  checks: "text-muted",
  you: "text-violet",
  system: "text-muted",
};

/** Built-in agents and system actors have their own color; agents you create are colored by role. */
export function actorColor(actor: Actor, role?: AgentRole): string {
  return FIXED_COLOR[actor] ?? (role === "reviewer" ? "text-success" : "text-warning");
}

function isSystemActor(actor: Actor): actor is (typeof SYSTEM_ACTORS)[number] {
  return (SYSTEM_ACTORS as readonly string[]).includes(actor);
}

/** Agent names follow the crew of the surrounding workspace (see WorkspaceScope). */
export function useActorName(workspaceId?: string) {
  const { agentName } = useAppState();
  const scope = useWorkspaceScope();
  const t = useTranslations("actors");
  return (actor: Actor) => (isSystemActor(actor) ? t(actor) : agentName(actor, workspaceId ?? scope));
}

export function Glyph({ actor, size = 26, className, ring }: { actor: Actor; size?: number; className?: string; ring?: boolean }) {
  const name = useActorName()(actor);
  const { agentOf } = useAppState();
  const scope = useWorkspaceScope();
  const role = isSystemActor(actor) ? undefined : agentOf(actor, scope)?.role;
  const letter = actor === "checks" ? "✓" : actor === "system" ? "·" : (name[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-lg bg-glyph font-bold",
        actorColor(actor, role),
        ring && "ring-2 ring-current",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}
    >
      {letter}
    </span>
  );
}
