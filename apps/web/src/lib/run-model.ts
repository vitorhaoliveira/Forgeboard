import type { Actor, FlowNode, NodeState, RunEvent, Task } from "@forgeboard/shared";

export type NodeStates = Record<FlowNode, NodeState>;

/** Latest state of each flow node, replayed from the event log. */
export function nodeStates(events: RunEvent[]): NodeStates {
  const states: NodeStates = { task: "idle", forge: "idle", checks: "idle", hawk: "idle", you: "idle", merge: "idle" };
  for (const e of events) {
    if (e.type === "node") states[e.node] = e.state;
    // A new round resets the loop so the graph shows the current pass.
    if (e.type === "round" && e.round > 1) {
      states.checks = "idle";
      states.hawk = "idle";
    }
  }
  return states;
}

/** Number of issues in the last hand-back from Hawk to Forge, if any. */
export function lastHandBack(events: RunEvent[]): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "handoff" && e.actor === "hawk" && e.to === "forge") return Number(e.label) || 0;
  }
  return null;
}

export interface Segment {
  actor: Actor;
  start: number;
  end: number | null;
}

const NODE_ACTOR: Partial<Record<FlowNode, Actor>> = { forge: "forge", checks: "checks", hawk: "hawk", you: "you" };

/** When each agent was busy, for the timeline lanes. `end: null` means still going. */
export function segments(events: RunEvent[]): Segment[] {
  const open = new Map<Actor, number>();
  const out: Segment[] = [];
  for (const e of events) {
    if (e.type !== "node") continue;
    const actor = NODE_ACTOR[e.node];
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
const MARKERS = ["FORGEBOARD_QUESTION:", "FORGEBOARD_FORM:", "FORGEBOARD_ASSUMPTIONS:"];

/** Agent text without machine-readable parts (question marker, Hawk's verdict json). */
export function cleanAgentText(text: string): string {
  let out = text;
  const cut = Math.min(...MARKERS.map((m) => out.indexOf(m)).filter((i) => i !== -1));
  if (Number.isFinite(cut)) out = out.slice(0, cut);
  out = out.replace(/```json[\s\S]*?```\s*$/g, "");
  return out.trim();
}
