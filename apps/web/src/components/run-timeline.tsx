"use client";

import { useTranslations } from "next-intl";
import type { Actor } from "@forgeboard/shared";
import type { RoleOf } from "@/lib/flow-view";
import type { Segment } from "@/lib/run-model";
import { cn } from "@/lib/utils";
import { useActorName } from "./glyph";
import { SectionLabel } from "./ui";

const FIXED: Record<string, string> = {
  forge: "bg-accent",
  checks: "bg-muted",
  hawk: "bg-info",
  you: "bg-transparent border border-dashed border-violet",
};

/** When each agent was busy during the run, one lane per actor of the task's flow. */
export function RunTimeline({
  actors,
  roleOf,
  segments,
  start,
  end,
  live,
}: {
  actors: Actor[];
  roleOf: RoleOf;
  segments: Segment[];
  start: number;
  end: number;
  live: boolean;
}) {
  const color = (actor: Actor) => FIXED[actor] ?? (roleOf(actor) === "reviewer" ? "bg-success" : "bg-warning");
  const t = useTranslations("run");
  const name = useActorName();
  const span = end - start;
  const pct = (ms: number) => `${Math.min(100, Math.max(0, ((ms - start) / span) * 100))}%`;

  return (
    <div className="flex flex-col gap-2 border-t border-border bg-panel px-[22px] pt-3 pb-3.5">
      <div className="flex items-center gap-2.5">
        <SectionLabel>{t("timeline")}</SectionLabel>
        {live && (
          <span className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-full border border-danger/40 bg-panel-2 px-2.5 text-xs text-danger">
            <span className="size-1.5 animate-pulse rounded-full bg-danger" aria-hidden="true" />
            {t("live")}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {actors.map((actor) => (
          <div key={actor} className="flex h-5 items-center gap-2.5">
            <span className="w-24 shrink-0 truncate text-[11.5px] text-muted">{name(actor)}</span>
            <span className="relative h-2.5 grow">
              {segments
                .filter((s) => s.actor === actor)
                .map((s) => {
                  const segEnd = s.end ?? end;
                  return (
                    <span
                      key={`${actor}-${s.start}`}
                      className={cn("absolute top-0 h-2.5 min-w-1 rounded-[3px]", color(actor), s.end === null && "shadow-[0_0_10px_rgba(249,115,22,.5)]")}
                      style={{ left: pct(s.start), width: `calc(${pct(segEnd)} - ${pct(s.start)})` }}
                    />
                  );
                })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
