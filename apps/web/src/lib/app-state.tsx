"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ProviderInfo, Repo, Task } from "@forgeboard/shared";
import { api } from "./api";

const REPO_KEY = "forgeboard:selectedRepo";

interface AppState {
  repos: Repo[];
  selectedRepo: Repo | null;
  selectRepo: (id: string) => void;
  addRepo: (path: string) => Promise<Repo>;
  tasks: Task[];
  refreshTasks: () => Promise<void>;
  providers: ProviderInfo[];
  /** Set when the local server can't be reached. */
  serverError: string | null;
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
    // Storage blocked (private mode): selection just won't persist.
  }
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [repoList, providerList] = await Promise.all([api.repos(), api.providers()]);
      setRepos(repoList);
      setProviders(providerList);
      setServerError(null);
      const stored = readStoredRepo();
      setSelectedRepoId((current) => {
        const wanted = current ?? stored;
        return repoList.some((r) => r.id === wanted) ? wanted : (repoList[0]?.id ?? null);
      });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const refreshTasks = useCallback(async () => {
    try {
      setTasks(await api.tasks());
      setServerError(null);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void load();
    void refreshTasks();
  }, [load, refreshTasks]);

  // Keep the sidebar statuses fresh. Polling a localhost server is cheap.
  useEffect(() => {
    const id = setInterval(() => {
      if (serverError) void load();
      void refreshTasks();
    }, 3000);
    return () => clearInterval(id);
  }, [load, refreshTasks, serverError]);

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

  const value = useMemo<AppState>(
    () => ({
      repos,
      selectedRepo: repos.find((r) => r.id === selectedRepoId) ?? null,
      selectRepo,
      addRepo,
      tasks,
      refreshTasks,
      providers,
      serverError,
    }),
    [repos, selectedRepoId, selectRepo, addRepo, tasks, refreshTasks, providers, serverError],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used inside AppStateProvider");
  return ctx;
}
