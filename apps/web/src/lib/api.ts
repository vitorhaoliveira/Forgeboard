import {
  DEFAULT_SERVER_PORT,
  type Agent,
  type CheckCommand,
  type CreateTaskInput,
  type CreateWorkspaceInput,
  type DiffFile,
  type HouseRule,
  type ProviderInfo,
  type Repo,
  type RuleScope,
  type RuleSource,
  type RunEvent,
  type Task,
  type Workspace,
} from "@forgeboard/shared";

export const API_URL = process.env.NEXT_PUBLIC_FORGEBOARD_API ?? `http://127.0.0.1:${DEFAULT_SERVER_PORT}`;

export class ServerDownError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ServerDownError(API_URL);
  }
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

export const api = {
  providers: () => request<ProviderInfo[]>("/api/providers"),

  workspaces: () => request<Workspace[]>("/api/workspaces"),
  createWorkspace: (input: CreateWorkspaceInput) => request<Workspace>("/api/workspaces", post(input)),
  updateWorkspace: (id: string, data: Partial<Omit<Workspace, "id" | "createdAt">>) =>
    request<Workspace>(`/api/workspaces/${id}`, patch(data)),
  removeWorkspace: (id: string) => request<void>(`/api/workspaces/${id}`, del),

  repos: (workspaceId?: string) => request<Repo[]>(`/api/repos${wsQuery(workspaceId)}`),
  addRepo: (workspaceId: string, path: string) => request<Repo>("/api/repos", post({ path, workspaceId })),
  updateRepo: (id: string, data: { checks?: CheckCommand[]; workspaceId?: string }) => request<Repo>(`/api/repos/${id}`, patch(data)),
  removeRepo: (id: string) => request<void>(`/api/repos/${id}`, del),

  /** Without a workspace: the default crew. With one: the crew that workspace uses. */
  agents: (workspaceId?: string) => request<Agent[]>(`/api/agents${wsQuery(workspaceId)}`),
  updateAgent: (id: string, data: Partial<Agent>, workspaceId?: string) =>
    request<Agent>(`/api/agents/${id}${wsQuery(workspaceId)}`, patch(data)),
  resetAgent: (id: string, workspaceId: string) => request<Agent>(`/api/agents/${id}${wsQuery(workspaceId)}`, del),

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
  answer: (id: string, text: string, remember: boolean) => request<Task>(`/api/tasks/${id}/answer`, post({ text, remember })),
  sendBack: (id: string, notes: string) => request<Task>(`/api/tasks/${id}/send-back`, post({ notes })),
  merge: (id: string, exclude: string[] = []) => request<Task>(`/api/tasks/${id}/merge`, post({ exclude })),
  discard: (id: string) => request<Task>(`/api/tasks/${id}/discard`, post()),
  stop: (id: string) => request<{ ok: boolean }>(`/api/tasks/${id}/stop`, post()),
  streamUrl: (id: string, after: number) => `${API_URL}/api/tasks/${id}/stream?after=${after}`,
};
