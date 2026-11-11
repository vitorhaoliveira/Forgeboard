"use client";

import { useTranslations } from "next-intl";
import { Check, GitMerge, Hand, Sparkles, X } from "lucide-react";
import type { Actor, FlowNode, NodeState } from "@forgeboard/shared";
import type { NodeStates } from "@/lib/run-model";
import { cn } from "@/lib/utils";
import { Glyph, useActorName } from "./glyph";

const ORDER: FlowNode[] = ["task", "forge", "checks", "hawk", "you", "merge"];
const STEP = 176;
const NODE_W = 140;
const TOP = 64;

const SELECTABLE: Partial<Record<FlowNode, Actor>> = { forge: "forge", checks: "checks", hawk: "hawk", you: "you" };

function Badge({ state }: { state: NodeState }) {
  if (state === "idle" || state === "active") return null;
  const styles = { done: "bg-success", failed: "bg-danger", warn: "bg-warning" } as const;
  return (
    <span aria-hidden="true" className={cn("absolute -top-[7px] -right-[7px] grid size-[18px] place-items-center rounded-full border-2 border-bg text-bg", styles[state])}>
      {state === "done" ? <Check className="size-2.5" strokeWidth={3.5} /> : state === "failed" ? <X className="size-2.5" strokeWidth={3.5} /> : <span className="text-[10px] font-bold">!</span>}
    </span>
  );
}

export interface FlowGraphProps {
  states: NodeStates;
  /** Line under each node's name (live activity, results…). */
  notes?: Partial<Record<FlowNode, string>>;
  loopActive?: boolean;
  loopLabel?: string;
  selected?: Actor | null;
  onSelect?: (actor: Actor) => void;
}

/** The Build & Review flow as a graph. Nodes light up as the run moves. */
export function FlowGraph({ states, notes = {}, loopActive, loopLabel, selected, onSelect }: FlowGraphProps) {
  const t = useTranslations("flow");
  const name = useActorName();

  const label: Record<FlowNode, string> = {
    task: t("task"),
    forge: name("forge"),
    checks: t("checks"),
    hawk: name("hawk"),
    you: t("you"),
    merge: t("merge"),
  };
  const role: Record<FlowNode, string> = {
    task: t("roleTask"),
    forge: t("roleForge"),
    checks: t("roleChecks"),
    hawk: t("roleHawk"),
    you: t("roleYou"),
    merge: t("roleMerge"),
  };

  const icon = (n: FlowNode) => {
    if (n === "forge" || n === "hawk") return <Glyph actor={n} />;
    const Icon = n === "task" ? Sparkles : n === "checks" ? Check : n === "you" ? Hand : GitMerge;
    return (
      <span className="grid size-[26px] shrink-0 place-items-center rounded-lg border border-border bg-panel-2 text-muted">
        <Icon className={cn("size-3.5", n === "task" && "text-accent", n === "you" && "text-violet")} aria-hidden="true" />
      </span>
    );
  };

  const forgeCenter = STEP * 1 + NODE_W / 2;
  const hawkCenter = STEP * 3 + NODE_W / 2;

  return (
    <div className="relative mx-auto h-[150px] shrink-0" style={{ width: STEP * (ORDER.length - 1) + NODE_W }}>
      {/* Loop back from Hawk to Forge */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute rounded-t-[14px] border-x-2 border-t-2",
          loopActive ? "border-solid border-accent" : "border-dashed border-border-strong",
        )}
        style={{ left: forgeCenter, width: hawkCenter - forgeCenter, top: 22, height: TOP - 22 }}
      />
      {loopLabel && (
        <span
          className={cn(
            "absolute -translate-x-1/2 rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap",
            loopActive ? "border-accent bg-accent font-semibold text-bg" : "border-border bg-bg text-muted",
          )}
          style={{ left: (forgeCenter + hawkCenter) / 2, top: 11 }}
        >
          {loopLabel}
        </span>
      )}

      {ORDER.slice(0, -1).map((n, i) => {
        const next = ORDER[i + 1]!;
        const lit = states[next] !== "idle" && states[n] !== "idle";
        return (
          <span
            key={`edge-${n}`}
            aria-hidden="true"
            className={cn("absolute h-0.5", lit ? "bg-success/55" : "bg-[#1f1f23]")}
            style={{ left: STEP * i + NODE_W, width: STEP - NODE_W, top: TOP + 29 }}
          />
        );
      })}

      {ORDER.map((n, i) => {
        const state = states[n];
        const actor = SELECTABLE[n];
        const isSelected = actor && selected === actor;
        const content = (
          <>
            {icon(n)}
            <span className="min-w-0 text-left">
              <b className="block text-[13px] font-medium">{label[n]}</b>
              <small className={cn("block truncate text-[11px] text-muted", state === "active" && "text-[#fdba74]")}>
                {notes[n] ?? role[n]}
              </small>
            </span>
            <Badge state={state} />
          </>
        );
        const className = cn(
          "absolute flex h-[60px] items-center gap-2.5 rounded-xl border border-border bg-panel px-3 transition",
          state === "idle" && n !== "task" && "opacity-45",
          state === "active" && "border-accent shadow-[0_0_0_4px_rgba(249,115,22,.16),0_0_28px_rgba(249,115,22,.18)]",
          n === "you" && state !== "active" && "border-dashed",
          isSelected && state !== "active" && "border-border-strong bg-panel-2",
          actor && "cursor-pointer hover:border-border-strong",
        );
        const style = { left: STEP * i, top: TOP, width: NODE_W };
        return actor && onSelect ? (
          <button key={n} type="button" onClick={() => onSelect(actor)} aria-pressed={Boolean(isSelected)} className={className} style={style}>
            {content}
          </button>
        ) : (
          <div key={n} className={className} style={style}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
