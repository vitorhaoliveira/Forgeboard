import {
  DEFAULT_SERVER_PORT,
  type Agent,
  type CheckCommand,
  type CreateAgentInput,
  type CreateTeamInput,
  type CreateTaskInput,
  type CreateWorkspaceInput,
  type DiffFile,
  type Flow,
  type FlowInput,
  type FolderListing,
  type FormAnswer,
  type MessageDelivery,
  type HouseRule,
  type ProposeTeamInput,
  type ProviderInfo,
  type Repo,
  type RuleScope,
  type RuleSource,
  type RunEvent,
  type Task,
  type Team,
  type TeamDraft,
  type TeamProposal,
  type Workspace,
} from "@forgeboard/shared";
import { demoApi } from "./demo/demo-api";

export const API_URL = process.env.NEXT_PUBLIC_FORGEBOARD_API ?? `http://127.0.0.1:${DEFAULT_SERVER_PORT}`;

export class ServerDownError extends Error {}
/** The server wants the access key: open the link printed by `forgeboard`. */
export class UnauthorizedError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch (err) {
    // Stopped on purpose (e.g. "Cancel" while the AI designs a team): not a server problem.
    if (init?.signal?.aborted) throw err;
    throw new ServerDownError(API_URL);
  }
  if (res.status === 401) throw new UnauthorizedError("unauthorized");
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const post = (body?: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body ?? {}) });
const patch = (body: unknown): RequestInit => ({ method: "PATCH", body: JSON.stringify(body) });
const del: RequestInit = { method: "DELETE" };
const wsQuery = (workspaceId?: string) => (workspaceId ? `?workspaceId=${workspaceId}` : "");

/** Extra parts of an answer to a form: the filled-in data, a note, or a request for another plan. */
export interface AnswerExtra {
  data?: FormAnswer;
  note?: string;
  replan?: boolean;
}

export interface StreamHandlers {
  onEvent: (event: RunEvent) => void;
  /** The task finished; no more events will come. */
  onEnd: () => void;
}

const realApi = {
  providers: () => request<ProviderInfo[]>("/api/providers"),

  workspaces: () => request<Workspace[]>("/api/workspaces"),
  createWorkspace: (input: CreateWorkspaceInput) => request<Workspace>("/api/workspaces", post(input)),
  updateWorkspace: (id: string, data: Partial<Omit<Workspace, "id" | "createdAt">>) =>
    request<Workspace>(`/api/workspaces/${id}`, patch(data)),
  removeWorkspace: (id: string) => request<void>(`/api/workspaces/${id}`, del),

  /** Subfolders of a folder on this machine (home by default), for picking a repository. */
  folders: (path?: string) => request<FolderListing>(`/api/folders${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  /** Starts tracking a plain folder (git init and a first commit), so a workspace can use it. */
  trackFolder: (path: string) => request<{ path: string }>("/api/folders/track", post({ path })),

  repos: (workspaceId?: string) => request<Repo[]>(`/api/repos${wsQuery(workspaceId)}`),
  addRepo: (workspaceId: string, path: string) => request<Repo>("/api/repos", post({ path, workspaceId })),
  updateRepo: (id: string, data: { checks?: CheckCommand[]; workspaceId?: string }) => request<Repo>(`/api/repos/${id}`, patch(data)),
  removeRepo: (id: string) => request<void>(`/api/repos/${id}`, del),

  /** Without a workspace: the default crew. With one: the crew that workspace uses. */
  agents: (workspaceId?: string) => request<Agent[]>(`/api/agents${wsQuery(workspaceId)}`),
  updateAgent: (id: string, data: Partial<Agent>, workspaceId?: string) =>
    request<Agent>(`/api/agents/${id}${wsQuery(workspaceId)}`, patch(data)),
  resetAgent: (id: string, workspaceId: string) => request<Agent>(`/api/agents/${id}${wsQuery(workspaceId)}`, del),
  /** Creates an agent in the default crew, or in a workspace's own crew. */
  createAgent: (input: CreateAgentInput, workspaceId?: string) => request<Agent>(`/api/agents${wsQuery(workspaceId)}`, post(input)),
  /** Deletes an agent you created (built-in agents can only be reset). */
  removeAgent: (id: string, workspaceId?: string) => request<void>(`/api/agents/${id}${wsQuery(workspaceId)}`, del),

  /** Teams you made (templates are in @forgeboard/shared). */
  teams: () => request<Team[]>("/api/teams"),
  createTeam: (input: CreateTeamInput) => request<Team>("/api/teams", post(input)),
  /** Asks an AI to design a team, or change one (teamId). Nothing is saved. */
  proposeTeam: (input: ProposeTeamInput, signal?: AbortSignal) => request<TeamProposal>("/api/teams/propose", { ...post(input), signal }),
  /** Replaces a team with a draft you approved. */
  applyTeamDraft: (id: string, draft: TeamDraft) => request<Team>(`/api/teams/${id}/apply`, post({ draft })),
  updateTeam: (id: string, data: Partial<Pick<Team, "name" | "description" | "planning" | "kind" | "about" | "commands">>) => request<Team>(`/api/teams/${id}`, patch(data)),
  removeTeam: (id: string) => request<void>(`/api/teams/${id}`, del),
  createTeamAgent: (teamId: string, input: CreateAgentInput) => request<Agent>(`/api/teams/${teamId}/agents`, post(input)),
  updateTeamAgent: (teamId: string, id: string, data: Partial<Agent>) => request<Agent>(`/api/teams/${teamId}/agents/${id}`, patch(data)),
  removeTeamAgent: (teamId: string, id: string) => request<void>(`/api/teams/${teamId}/agents/${id}`, del),

  /** Built-in flows first, then the ones you made. */
  flows: () => request<Flow[]>("/api/flows"),
  createFlow: (input: FlowInput) => request<Flow>("/api/flows", post(input)),
  updateFlow: (id: string, input: FlowInput) => request<Flow>(`/api/flows/${id}`, patch(input)),
  removeFlow: (id: string) => request<void>(`/api/flows/${id}`, del),

  rules: (scope: RuleScope, id?: string) => request<HouseRule[]>(`/api/rules?scope=${scope}${id ? `&id=${id}` : ""}`),
  addRule: (scope: RuleScope, id: string | null, text: string, source: RuleSource = "you") =>
    request<HouseRule>("/api/rules", post({ scope, id, text, source })),
  updateRule: (id: string, data: { enabled?: boolean; text?: string; scope?: RuleScope; id?: string | null }) =>
    request<HouseRule>(`/api/rules/${id}`, patch(data)),
  removeRule: (id: string) => request<void>(`/api/rules/${id}`, del),

  tasks: () => request<Task[]>("/api/tasks"),
  task: (id: string) => request<{ task: Task; events: RunEvent[] }>(`/api/tasks/${id}`),
  createTask: (input: CreateTaskInput) => request<Task>("/api/tasks", post(input)),
  diff: (id: string) => request<DiffFile[]>(`/api/tasks/${id}/diff`),
  answer: (id: string, text: string, remember: boolean, extra?: AnswerExtra) =>
    request<Task>(`/api/tasks/${id}/answer`, post({ text, remember, ...extra })),
  sendBack: (id: string, notes: string) => request<Task>(`/api/tasks/${id}/send-back`, post({ notes })),
  merge: (id: string, exclude: string[] = []) => request<Task>(`/api/tasks/${id}/merge`, post({ exclude })),
  message: (id: string, text: string, delivery: MessageDelivery) => request<Task>(`/api/tasks/${id}/message`, post({ text, delivery })),
  ackAssumptions: (id: string) => request<Task>(`/api/tasks/${id}/assumptions/ack`, post()),
  discard: (id: string) => request<Task>(`/api/tasks/${id}/discard`, post()),
  stop: (id: string) => request<{ ok: boolean }>(`/api/tasks/${id}/stop`, post()),
  /** Follows a task's events after `after`. Returns a function that stops listening. */
  subscribe(id: string, after: number, handlers: StreamHandlers): () => void {
    const source = new EventSource(`${API_URL}/api/tasks/${id}/stream?after=${after}`);
    source.addEventListener("run", (msg) => handlers.onEvent(JSON.parse((msg as MessageEvent<string>).data) as RunEvent));
    source.addEventListener("end", () => {
      source.close();
      handlers.onEnd();
    });
    return () => source.close();
  },
};

export type Api = typeof realApi;

/** The hosted demo runs a simulated crew in the browser instead of talking to a local server. */
export const IS_DEMO = process.env.NEXT_PUBLIC_FORGEBOARD_DEMO === "1";

export const api: Api = IS_DEMO ? demoApi : realApi;
