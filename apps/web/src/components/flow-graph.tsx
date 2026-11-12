"use client";

import { useTranslations } from "next-intl";
import { Check, GitMerge, Hand, MessageCircleQuestion, Sparkles, X } from "lucide-react";
import { BUILD_AND_REVIEW_ID, LEAD_DECIDES_ID, type Actor, type Flow, type FlowStep, type NodeState } from "@forgeboard/shared";
import { sendBackIndex, stepActor, type RoleOf } from "@/lib/flow-view";
import type { HandBack, NodeStates } from "@/lib/run-model";
import { cn } from "@/lib/utils";
import { Glyph, useActorName } from "./glyph";
import { useAcceptWords } from "@/lib/app-state";

const STEP = 176;
const NODE_W = 140;
/** Height of one loop arc level above the nodes. */
const LOOP_LEVEL = 18;

function Badge({ state }: { state: NodeState }) {
  if (state === "idle" || state === "active") return null;
  const styles = { done: "bg-success", failed: "bg-danger", warn: "bg-warning" } as const;
  return (
    <span aria-hidden="true" className={cn("absolute -top-[7px] -right-[7px] grid size-[18px] place-items-center rounded-full border-2 border-bg text-bg", styles[state])}>
      {state === "done" ? <Check className="size-2.5" strokeWidth={3.5} /> : state === "failed" ? <X className="size-2.5" strokeWidth={3.5} /> : <span className="text-[10px] font-bold">!</span>}
    </span>
  );
}

/** The name of a flow: built-in ones are translated. */
export function useFlowName() {
  const t = useTranslations("flow");
  return (flow: Pick<Flow, "id" | "name" | "builtIn">) =>
    !flow.builtIn ? flow.name : flow.id === LEAD_DECIDES_ID ? t("leadName") : flow.id === BUILD_AND_REVIEW_ID ? t("name") : flow.name;
}

export interface FlowGraphProps {
  flow: Flow;
  roleOf: RoleOf;
  states: NodeStates;
  /** Line under each node's name (live activity, results…), by node id. */
  notes?: Record<string, string>;
  /** Rounds for reviewers that don't set their own. */
  defaultRounds?: number;
  /** The hand-back that started the current round, to label its loop with the number of issues. */
  handBack?: HandBack | null;
  round?: number;
  selected?: Actor | null;
  onSelect?: (actor: Actor) => void;
}

type GraphNode = { id: string; step?: FlowStep };

/** A flow as a graph: your task, its steps, then you and the merge. Nodes light up as the run moves. */
export function FlowGraph({ flow, roleOf, states, notes = {}, defaultRounds = 3, handBack, round = 0, selected, onSelect }: FlowGraphProps) {
  const accept = useAcceptWords();
  const t = useTranslations("flow");
  const name = useActorName();

  const nodes: GraphNode[] = [{ id: "task" }, ...flow.steps.map((step) => ({ id: step.id, step })), { id: "you" }, { id: "merge" }];

  // Each reviewer that sends work back draws an arc to its builder; shorter arcs sit lower.
  const loops = flow.steps
    .map((step, i) => ({ step, from: i, to: sendBackIndex(flow, i, roleOf) }))
    // Only backward arcs: a target after the reviewer is an invalid flow still being edited.
    .filter((l) => l.to !== -1 && l.to < l.from && l.step.type === "agent")
    .sort((a, b) => a.from - a.to - (b.from - b.to))
    .map((l, level) => {
      const agentId = l.step.type === "agent" ? l.step.agentId : "";
      const target = flow.steps[l.to]!;
      const mine = Boolean(handBack) && round > 1 && (handBack!.fromStep ? handBack!.fromStep === l.step.id : handBack!.from === agentId);
      const max = (l.step.type === "agent" && l.step.maxRounds) || defaultRounds;
      const targetName = target.type === "agent" ? name(target.agentId) : "";
      return {
        key: l.step.id,
        // Node indexes are step indexes + 1 (the task node comes first).
        left: STEP * (l.to + 1) + NODE_W / 2,
        right: STEP * (l.from + 1) + NODE_W / 2,
        level,
        active: mine && states[target.id] === "active",
        label: mine ? t("issuesTo", { count: handBack!.count, name: targetName }) : t("loopLabel", { max }),
      };
    });
  const top = 22 + loops.length * LOOP_LEVEL + (loops.length ? 20 : 0);

  const label = (n: GraphNode) => {
    if (n.id === "merge" && accept) return t("mergeAccept");
    if (!n.step) return t(n.id as "task" | "you" | "merge");
    return n.step.type === "agent" || n.step.type === "lead" ? name(n.step.agentId) : n.step.type === "checks" ? t("checks") : t("ask");
  };
  const role = (n: GraphNode) => {
    if (!n.step) return n.id === "task" ? t("roleTask") : n.id === "you" ? t("roleYou") : t(accept ? "roleMergeAccept" : "roleMerge");
    if (n.step.type === "lead") return t("roleLead");
    if (n.step.type === "agent") return roleOf(n.step.agentId) === "reviewer" ? t("roleHawk") : t(accept ? "roleMaker" : "roleForge");
    return n.step.type === "checks" ? t(accept ? "roleChecksAny" : "roleChecks") : t("roleAsk");
  };
  const icon = (n: GraphNode) => {
    if (n.step?.type === "agent" || n.step?.type === "lead") return <Glyph actor={n.step.agentId} />;
    const Icon = !n.step ? (n.id === "task" ? Sparkles : n.id === "you" ? Hand : GitMerge) : n.step.type === "checks" ? Check : MessageCircleQuestion;
    return (
      <span className="grid size-[26px] shrink-0 place-items-center rounded-lg border border-border bg-panel-2 text-muted">
        <Icon className={cn("size-3.5", n.id === "task" && "text-accent", (n.id === "you" || n.step?.type === "ask") && "text-violet")} aria-hidden="true" />
      </span>
    );
  };

  return (
    <div className="relative mx-auto shrink-0" style={{ width: STEP * (nodes.length - 1) + NODE_W, height: top + 86 }}>
      {loops.map((l) => {
        const arcTop = top - 22 - l.level * LOOP_LEVEL - 20;
        return (
          <span key={l.key}>
            <span
              aria-hidden="true"
              className={cn("absolute rounded-t-[14px] border-x-2 border-t-2", l.active ? "border-solid border-accent" : "border-dashed border-border-strong")}
              style={{ left: l.left, width: l.right - l.left, top: arcTop + 11, height: top - arcTop - 11 }}
            />
            <span
              className={cn(
                "absolute -translate-x-1/2 rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap",
                l.active ? "border-accent bg-accent font-semibold text-bg" : "border-border bg-bg text-muted",
              )}
              style={{ left: (l.left + l.right) / 2, top: arcTop }}
            >
              {l.label}
            </span>
          </span>
        );
      })}

      {nodes.slice(0, -1).map((n, i) => {
        const next = nodes[i + 1]!;
        const lit = states[next.id] !== "idle" && states[n.id] !== "idle";
        return (
          <span
            key={`edge-${n.id}`}
            aria-hidden="true"
            className={cn("absolute h-0.5", lit ? "bg-success/55" : "bg-[#1f1f23]")}
            style={{ left: STEP * i + NODE_W, width: STEP - NODE_W, top: top + 29 }}
          />
        );
      })}

      {nodes.map((n, i) => {
        const state = states[n.id] ?? "idle";
        const actor: Actor | null = n.step ? stepActor(n.step) : n.id === "you" ? "you" : null;
        const isSelected = actor !== null && selected === actor;
        const content = (
          <>
            {icon(n)}
            <span className="min-w-0 text-left">
              <b className="block truncate text-[13px] font-medium">{label(n)}</b>
              <small className={cn("block truncate text-[11px] text-muted", state === "active" && "text-[#fdba74]")}>{notes[n.id] ?? role(n)}</small>
            </span>
            <Badge state={state} />
          </>
        );
        const className = cn(
          "absolute flex h-[60px] items-center gap-2.5 rounded-xl border border-border bg-panel px-3 transition",
          state === "idle" && n.id !== "task" && "opacity-45",
          state === "active" && "border-accent shadow-[0_0_0_4px_rgba(249,115,22,.16),0_0_28px_rgba(249,115,22,.18)]",
          (n.id === "you" || n.step?.type === "ask") && state !== "active" && "border-dashed",
          isSelected && state !== "active" && "border-border-strong bg-panel-2",
          actor && onSelect && "cursor-pointer hover:border-border-strong",
        );
        const style = { left: STEP * i, top, width: NODE_W };
        return actor && onSelect ? (
          <button key={n.id} type="button" onClick={() => onSelect(actor)} aria-pressed={isSelected} className={className} style={style}>
            {content}
          </button>
        ) : (
          <div key={n.id} className={className} style={style}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
