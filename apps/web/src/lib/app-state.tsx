"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Agent, AgentId, ProviderInfo, Repo, Task } from "@forgeboard/shared";
import { api, ServerDownError } from "./api";

const REPO_KEY = "forgeboard:selectedRepo";

interface AppState {
  repos: Repo[];
  selectedRepo: Repo | null;
  selectRepo: (id: string) => void;
  addRepo: (path: string) => Promise<Repo>;
  refreshRepos: () => Promise<void>;
  /** Tasks of the selected repository, newest first. */
  tasks: Task[];
  refreshTasks: () => Promise<void>;
  providers: ProviderInfo[];
  agents: Agent[];
  agentName: (id: AgentId) => string;
  refreshAgents: () => Promise<void>;
  /** True when the local server can't be reached. */
  serverDown: boolean;
  loaded: boolean;
}

const AppStateContext = createContext<AppState | null>(null);

function readStoredRepo(): string | null {
  try {
    return localStorage.getItem(REPO_KEY);
  } catch {
    return null;
  }
}

function storeRepo(id: string) {
  try {
    localStorage.setItem(REPO_KEY, id);
  } catch {
    // Storage blocked: the selection just won't persist.
  }
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [serverDown, setServerDown] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const guard = useCallback(async (fn: () => Promise<void>) => {
    try {
      await fn();
      setServerDown(false);
    } catch (err) {
      if (err instanceof ServerDownError) setServerDown(true);
      else throw err;
    }
  }, []);

  const refreshRepos = useCallback(
    () =>
      guard(async () => {
        const list = await api.repos();
        setRepos(list);
        setSelectedRepoId((current) => {
          const wanted = current ?? readStoredRepo();
          return list.some((r) => r.id === wanted) ? wanted : (list[0]?.id ?? null);
        });
      }),
    [guard],
  );

  const refreshAgents = useCallback(
    () =>
      guard(async () => {
        const [a, p] = await Promise.all([api.agents(), api.providers()]);
        setAgents(a);
        setProviders(p);
      }),
    [guard],
  );

  const refreshTasks = useCallback(
    () =>
      guard(async () => {
        setTasks(selectedRepoId ? await api.tasks(selectedRepoId) : []);
      }),
    [guard, selectedRepoId],
  );

  useEffect(() => {
    void Promise.all([refreshRepos(), refreshAgents()]).finally(() => setLoaded(true));
  }, [refreshRepos, refreshAgents]);

  // Keep statuses fresh everywhere. Polling a localhost server is cheap.
  useEffect(() => {
    void refreshTasks();
    const id = setInterval(() => {
      if (serverDown) void refreshRepos();
      void refreshTasks();
    }, 2500);
    return () => clearInterval(id);
  }, [refreshTasks, refreshRepos, serverDown]);

  const selectRepo = useCallback((id: string) => {
    setSelectedRepoId(id);
    storeRepo(id);
  }, []);

  const addRepo = useCallback(
    async (path: string) => {
      const repo = await api.addRepo(path);
      setRepos((prev) => [repo, ...prev.filter((r) => r.id !== repo.id)]);
      selectRepo(repo.id);
      return repo;
    },
    [selectRepo],
  );

  const agentName = useCallback(
    (id: AgentId) => agents.find((a) => a.id === id)?.name ?? (id === "forge" ? "Forge" : "Hawk"),
    [agents],
  );

  const value = useMemo<AppState>(
    () => ({
      repos,
      selectedRepo: repos.find((r) => r.id === selectedRepoId) ?? null,
      selectRepo,
      addRepo,
      refreshRepos,
      tasks,
      refreshTasks,
      providers,
      agents,
      agentName,
      refreshAgents,
      serverDown,
      loaded,
    }),
    [repos, selectedRepoId, selectRepo, addRepo, refreshRepos, tasks, refreshTasks, providers, agents, agentName, refreshAgents, serverDown, loaded],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used inside AppStateProvider");
  return ctx;
}
