"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Agent, AgentId, ProviderInfo, Repo, Task, Workspace } from "@forgeboard/shared";
import { api, ServerDownError, UnauthorizedError } from "./api";

const LAST_REPO_KEY = "forgeboard:lastRepo";

interface AppState {
  workspaces: Workspace[];
  /** Workspaces shown in the rail (not archived). */
  activeWorkspaces: Workspace[];
  workspace: (id: string | undefined) => Workspace | undefined;
  refreshWorkspaces: () => Promise<void>;
  repos: Repo[];
  repo: (id: string | undefined) => Repo | undefined;
  refreshRepos: () => Promise<void>;
  /** Every task, newest first. Views filter by workspace or repo. */
  tasks: Task[];
  refreshTasks: () => Promise<void>;
  providers: ProviderInfo[];
  /** Crew per workspace id; "default" holds the default crew. */
  crews: Record<string, Agent[]>;
  agentName: (id: AgentId, workspaceId?: string) => string;
  refreshCrews: () => Promise<void>;
  lastRepoId: string | null;
  rememberRepo: (id: string) => void;
  newWorkspaceOpen: boolean;
  setNewWorkspaceOpen: (open: boolean) => void;
  /** True when the local server can't be reached. */
  serverDown: boolean;
  /** True when the server needs the access key this browser doesn't have. */
  locked: boolean;
  loaded: boolean;
}

const AppStateContext = createContext<AppState | null>(null);

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice just won't persist.
  }
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [crews, setCrews] = useState<Record<string, Agent[]>>({});
  const [lastRepoId, setLastRepoId] = useState<string | null>(null);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [serverDown, setServerDown] = useState(false);
  const [locked, setLocked] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => setLastRepoId(readStored(LAST_REPO_KEY)), []);

  const guard = useCallback(async (fn: () => Promise<void>) => {
    try {
      await fn();
      setServerDown(false);
      setLocked(false);
    } catch (err) {
      if (err instanceof ServerDownError) setServerDown(true);
      else if (err instanceof UnauthorizedError) setLocked(true);
      else throw err;
    }
  }, []);

  const refreshRepos = useCallback(() => guard(async () => setRepos(await api.repos())), [guard]);
  const refreshTasks = useCallback(() => guard(async () => setTasks(await api.tasks())), [guard]);

  const refreshCrews = useCallback(
    () =>
      guard(async () => {
        const list = await api.workspaces();
        const [defaults, ...perWs] = await Promise.all([api.agents(), ...list.map((w) => api.agents(w.id))]);
        const next: Record<string, Agent[]> = { default: defaults! };
        list.forEach((w, i) => (next[w.id] = perWs[i]!));
        setCrews(next);
      }),
    [guard],
  );

  const refreshWorkspaces = useCallback(
    () =>
      guard(async () => {
        setWorkspaces(await api.workspaces());
        setProviders(await api.providers());
      }),
    [guard],
  );

  useEffect(() => {
    void Promise.all([refreshWorkspaces(), refreshRepos(), refreshTasks(), refreshCrews()]).finally(() => setLoaded(true));
  }, [refreshWorkspaces, refreshRepos, refreshTasks, refreshCrews]);

  // Keep statuses fresh everywhere. Polling a localhost server is cheap.
  useEffect(() => {
    const id = setInterval(() => {
      if (serverDown || locked) void Promise.all([refreshWorkspaces(), refreshRepos(), refreshCrews()]);
      void refreshTasks();
    }, 2500);
    return () => clearInterval(id);
  }, [refreshTasks, refreshRepos, refreshWorkspaces, refreshCrews, serverDown, locked]);

  const rememberRepo = useCallback((id: string) => {
    setLastRepoId(id);
    store(LAST_REPO_KEY, id);
  }, []);

  const agentName = useCallback(
    (id: AgentId, workspaceId?: string) =>
      (workspaceId && crews[workspaceId]?.find((a) => a.id === id)?.name) ||
      crews.default?.find((a) => a.id === id)?.name ||
      (id === "forge" ? "Forge" : "Hawk"),
    [crews],
  );

  const value = useMemo<AppState>(
    () => ({
      workspaces,
      activeWorkspaces: workspaces.filter((w) => !w.archived),
      workspace: (id) => workspaces.find((w) => w.id === id),
      refreshWorkspaces,
      repos,
      repo: (id) => repos.find((r) => r.id === id),
      refreshRepos,
      tasks,
      refreshTasks,
      providers,
      crews,
      agentName,
      refreshCrews,
      lastRepoId,
      rememberRepo,
      newWorkspaceOpen,
      setNewWorkspaceOpen,
      serverDown,
      locked,
      loaded,
    }),
    [workspaces, refreshWorkspaces, repos, refreshRepos, tasks, refreshTasks, providers, crews, agentName, refreshCrews, lastRepoId, rememberRepo, newWorkspaceOpen, serverDown, locked, loaded],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used inside AppStateProvider");
  return ctx;
}

/** The workspace a part of the page belongs to, so agent names follow its crew. */
const WorkspaceScopeContext = createContext<string | undefined>(undefined);

export function WorkspaceScope({ workspaceId, children }: { workspaceId: string | undefined; children: ReactNode }) {
  return <WorkspaceScopeContext.Provider value={workspaceId}>{children}</WorkspaceScopeContext.Provider>;
}

export function useWorkspaceScope(): string | undefined {
  return useContext(WorkspaceScopeContext);
}
