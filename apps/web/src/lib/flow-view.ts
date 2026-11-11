import { BUILD_AND_REVIEW, type Actor, type Agent, type AgentId, type AgentRole, type Flow, type FlowStep, type Task } from "@forgeboard/shared";

/** The flow a task runs. Tasks from before v2.0 have none: they ran Build & Review. */
export function flowOf(task: Pick<Task, "flow">): Flow {
  return task.flow ?? BUILD_AND_REVIEW;
}

export type RoleOf = (agentId: AgentId) => AgentRole | undefined;

/**
 * The role of an agent in a crew. An agent deleted since keeps a sensible role in old runs:
 * Hawk reviews, anyone else builds.
 */
export function roleOfIn(crew: Agent[] | undefined): (agentId: AgentId) => AgentRole {
  return (id) => crew?.find((a) => a.id === id)?.role ?? (id === "hawk" ? "reviewer" : "builder");
}

/** The actor a step's graph node stands for: its agent, or the checks. Pauses have none. */
export function stepActor(step: FlowStep): Actor | null {
  return step.type === "agent" ? step.agentId : step.type === "checks" ? "checks" : null;
}

/** Who takes part in a flow, in order of first appearance, then you. For filters and timeline lanes. */
export function flowActors(flow: Flow): Actor[] {
  const out: Actor[] = [];
  for (const step of flow.steps) {
    const a = stepActor(step);
    if (a && !out.includes(a)) out.push(a);
  }
  return [...out, "you"];
}

/** The first agent that builds: who a task is "for" on the desk (Forge in Build & Review). */
export function mainBuilder(flow: Flow, roleOf: RoleOf): AgentId {
  const step = flow.steps.find((s) => s.type === "agent" && roleOf(s.agentId) === "builder");
  return step?.type === "agent" ? step.agentId : "forge";
}

/** The last agent that builds: where your notes and messages go. */
export function lastBuilder(flow: Flow, roleOf: RoleOf): AgentId {
  const step = [...flow.steps].reverse().find((s) => s.type === "agent" && roleOf(s.agentId) === "builder");
  return step?.type === "agent" ? step.agentId : "forge";
}

/** The last agent that reviews (Hawk in Build & Review). */
export function lastReviewer(flow: Flow, roleOf: RoleOf): AgentId {
  const step = [...flow.steps].reverse().find((s) => s.type === "agent" && roleOf(s.agentId) === "reviewer");
  return step?.type === "agent" ? step.agentId : "hawk";
}

/** The builder step a reviewer step sends work back to, as an index, or -1. Mirrors the server. */
export function sendBackIndex(flow: Flow, index: number, roleOf: RoleOf): number {
  const step = flow.steps[index];
  if (step?.type !== "agent" || roleOf(step.agentId) !== "reviewer") return -1;
  if (step.sendBackTo) return flow.steps.findIndex((s) => s.id === step.sendBackTo);
  for (let i = index - 1; i >= 0; i--) {
    const s = flow.steps[i]!;
    if (s.type === "agent" && roleOf(s.agentId) === "builder") return i;
  }
  return -1;
}
