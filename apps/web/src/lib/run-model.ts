import type { Actor, AgentId, Flow, NodeState, RunEvent, Task } from "@forgeboard/shared";
import { sendBackIndex, stepActor, type RoleOf } from "./flow-view";

export type NodeStates = Record<string, NodeState>;

/** Every node of a flow's graph, idle. */
export function idleStates(flow: Flow): NodeStates {
  const states: NodeStates = { task: "idle", you: "idle", merge: "idle" };
  for (const step of flow.steps) states[step.id] = "idle";
  return states;
}

/** Latest state of each graph node, replayed from the event log. */
export function nodeStates(events: RunEvent[], flow: Flow, roleOf: RoleOf): NodeStates {
  const states = idleStates(flow);
  let handBack: { from: AgentId; fromStep?: string } | null = null;
  for (const e of events) {
    if (e.type === "node") states[e.node] = e.state;
    if (e.type === "handoff" && e.to !== "checks") handBack = { from: e.actor, fromStep: e.fromStep };
    // A new round resets the loop it starts, so the graph shows the current pass.
    if (e.type === "round" && e.round > 1) {
      const reviewer = handBack ? stepIndexOf(flow, handBack) : -1;
      let from = reviewer === -1 ? -1 : sendBackIndex(flow, reviewer, roleOf);
      if (from === -1) {
        // Your notes or messages: they go to the last builder.
        from = flow.steps.map((s, i) => [s, i] as const).reverse().find(([s]) => s.type === "agent" && roleOf(s.agentId) === "builder")?.[1] ?? 0;
      }
      flow.steps.slice(from).forEach((s) => (states[s.id] = "idle"));
      handBack = null;
    }
  }
  return states;
}

/** The reviewer step of a hand-back: by step id, or (events before v2.0.1) the first step of that agent. */
function stepIndexOf(flow: Flow, handBack: { from: AgentId; fromStep?: string }): number {
  if (handBack.fromStep) return flow.steps.findIndex((s) => s.id === handBack.fromStep);
  return flow.steps.findIndex((s) => s.type === "agent" && s.agentId === handBack.from);
}

export interface HandBack {
  from: AgentId;
  /** Missing on events from before v2.0.1. */
  fromStep?: string;
  count: number;
}

/**
 * The hand-back that started the current round: who sent it and how many issues. Null when the
 * current round started some other way (your notes, a pause, messages after approval).
 */
export function lastHandBack(events: RunEvent[]): HandBack | null {
  let rounds = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "round") rounds++;
    // A hand-back is followed by its own round event; a second one after it means it's old news.
    if (e.type === "handoff" && e.to !== "checks") return rounds <= 1 ? { from: e.actor, fromStep: e.fromStep, count: Number(e.label) || 0 } : null;
  }
  return null;
}

export interface Segment {
  actor: Actor;
  start: number;
  end: number | null;
}

/** When each agent was busy, for the timeline lanes. `end: null` means still going. */
export function segments(events: RunEvent[], flow: Flow): Segment[] {
  const nodeActor = new Map<string, Actor>([["you", "you"]]);
  for (const step of flow.steps) {
    const a = stepActor(step);
    if (a) nodeActor.set(step.id, a);
  }
  const open = new Map<Actor, number>();
  const out: Segment[] = [];
  for (const e of events) {
    if (e.type !== "node") continue;
    const actor = nodeActor.get(e.node);
    if (!actor) continue;
    const ts = new Date(e.ts).getTime();
    if (e.state === "active") {
      if (!open.has(actor)) open.set(actor, ts);
    } else if (open.has(actor)) {
      out.push({ actor, start: open.get(actor)!, end: ts });
      open.delete(actor);
    }
  }
  for (const [actor, start] of open) out.push({ actor, start, end: null });
  return out;
}

export function runBounds(events: RunEvent[], task: Task, now: number): { start: number; end: number } {
  const start = events.length ? new Date(events[0]!.ts).getTime() : new Date(task.createdAt).getTime();
  const end = task.finishedAt ? new Date(task.finishedAt).getTime() : now;
  return { start, end: Math.max(end, start + 1000) };
}

/** Lines agents end their message with, for Forgeboard to read. They aren't shown. */
const MARKERS = ["FORGEBOARD_QUESTION:", "FORGEBOARD_FORM:", "FORGEBOARD_ASSUMPTIONS:", "FORGEBOARD_PLAN:"];

/** Agent text without machine-readable parts (question marker, Hawk's verdict json). */
export function cleanAgentText(text: string): string {
  let out = text;
  const cut = Math.min(...MARKERS.map((m) => out.indexOf(m)).filter((i) => i !== -1));
  if (Number.isFinite(cut)) out = out.slice(0, cut);
  out = out.replace(/```json[\s\S]*?```\s*$/g, "");
  return out.trim();
}
