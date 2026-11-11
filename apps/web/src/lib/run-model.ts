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
  let handBackFrom: AgentId | null = null;
  for (const e of events) {
    if (e.type === "node") states[e.node] = e.state;
    if (e.type === "handoff" && e.to !== "checks") handBackFrom = e.actor;
    // A new round resets the loop it starts, so the graph shows the current pass.
    if (e.type === "round" && e.round > 1) {
      const reviewer = handBackFrom ? flow.steps.findIndex((s) => s.type === "agent" && s.agentId === handBackFrom) : -1;
      let from = reviewer === -1 ? -1 : sendBackIndex(flow, reviewer, roleOf);
      if (from === -1) {
        // Your notes or messages: they go to the last builder.
        from = flow.steps.map((s, i) => [s, i] as const).reverse().find(([s]) => s.type === "agent" && roleOf(s.agentId) === "builder")?.[1] ?? 0;
      }
      flow.steps.slice(from).forEach((s) => (states[s.id] = "idle"));
      handBackFrom = null;
    }
  }
  return states;
}

/** The last hand-back from a reviewer to a builder: who sent it and how many issues. */
export function lastHandBack(events: RunEvent[]): { from: AgentId; count: number } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === "handoff" && e.to !== "checks") return { from: e.actor, count: Number(e.label) || 0 };
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
const MARKERS = ["FORGEBOARD_QUESTION:", "FORGEBOARD_FORM:", "FORGEBOARD_ASSUMPTIONS:"];

/** Agent text without machine-readable parts (question marker, Hawk's verdict json). */
export function cleanAgentText(text: string): string {
  let out = text;
  const cut = Math.min(...MARKERS.map((m) => out.indexOf(m)).filter((i) => i !== -1));
  if (Number.isFinite(cut)) out = out.slice(0, cut);
  out = out.replace(/```json[\s\S]*?```\s*$/g, "");
  return out.trim();
}
