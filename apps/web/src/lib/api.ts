import {
  DEFAULT_SERVER_PORT,
  type CreateTaskInput,
  type ProviderInfo,
  type Repo,
  type RunEvent,
  type Task,
} from "@forgeboard/shared";

export const API_URL = process.env.NEXT_PUBLIC_FORGEBOARD_API ?? `http://127.0.0.1:${DEFAULT_SERVER_PORT}`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new Error(`Can't reach the Forgeboard server at ${API_URL}. Is it running?`);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  providers: () => request<ProviderInfo[]>("/api/providers"),
  repos: () => request<Repo[]>("/api/repos"),
  addRepo: (path: string) => request<Repo>("/api/repos", { method: "POST", body: JSON.stringify({ path }) }),
  tasks: (repoId?: string) => request<Task[]>(`/api/tasks${repoId ? `?repoId=${repoId}` : ""}`),
  task: (id: string) => request<{ task: Task; events: RunEvent[] }>(`/api/tasks/${id}`),
  createTask: (input: CreateTaskInput) =>
    request<Task>("/api/tasks", { method: "POST", body: JSON.stringify(input) }),
  cancelTask: (id: string) => request<{ ok: boolean }>(`/api/tasks/${id}/cancel`, { method: "POST" }),
  streamUrl: (id: string, after: number) => `${API_URL}/api/tasks/${id}/stream?after=${after}`,
};
