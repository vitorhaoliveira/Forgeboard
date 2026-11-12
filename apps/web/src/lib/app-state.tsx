"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { needsYou, type Agent, type AgentId, type Flow, type Team, type WorkKind, type ProviderInfo, type Repo, type Task, type Workspace } from "@forgeboard/shared";
import { api, ServerDownError, UnauthorizedError } from "./api";

const LAST_REPO_KEY = "forgeboard:lastRepo";
const NOTIFY_KEY = "forgeboard:notify";

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
  /** An agent of the crew a workspace uses (or of the default crew). */
  agentOf: (id: AgentId, workspaceId?: string) => Agent | undefined;
  refreshCrews: () => Promise<void>;
  /** Built-in flows first, then the ones you made. */
  flows: Flow[];
  refreshFlows: () => Promise<void>;
  /** Teams you made. */
  teams: Team[];
  refreshTeams: () => Promise<void>;
  lastRepoId: string | null;
  rememberRepo: (id: string) => void;
  newWorkspaceOpen: boolean;
  setNewWorkspaceOpen: (open: boolean) => void;
  /** True when the local server can't be reached. */
  serverDown: boolean;
  /** True when the server needs the access key this browser doesn't have. */
  locked: boolean;
  /** Browser notifications when an agent needs you (stored in this browser). */
  notify: boolean;
  setNotify: (on: boolean) => void;
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
  const [flows, setFlows] = useState<Flow[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [lastRepoId, setLastRepoId] = useState<string | null>(null);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [serverDown, setServerDown] = useState(false);
  const [locked, setLocked] = useState(false);
  const [notify, setNotifyState] = useState(false);
  useEffect(() => setNotifyState(readStored(NOTIFY_KEY) === "1"), []);
  const setNotify = useCallback((on: boolean) => {
    setNotifyState(on);
    try {
      localStorage.setItem(NOTIFY_KEY, on ? "1" : "0");
    } catch {
      // storage blocked: the choice lasts this visit only
    }
  }, []);
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

  const refreshFlows = useCallback(() => guard(async () => setFlows(await api.flows())), [guard]);
  const refreshTeams = useCallback(() => guard(async () => setTeams(await api.teams())), [guard]);

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
    void Promise.all([refreshWorkspaces(), refreshRepos(), refreshTasks(), refreshCrews(), refreshFlows(), refreshTeams()]).finally(() => setLoaded(true));
  }, [refreshWorkspaces, refreshRepos, refreshTasks, refreshCrews, refreshFlows, refreshTeams]);

  // System notification when a task starts needing you, if the tab isn't in view.
  const lastStatus = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const before = lastStatus.current;
    const first = before.size === 0;
    for (const task of tasks) {
      const prev = before.get(task.id);
      before.set(task.id, task.status);
      if (first || !notify || prev === task.status || !needsYou(task.status)) continue;
      if (typeof Notification === "undefined" || Notification.permission !== "granted" || document.visibilityState === "visible") continue;
      const body = task.status === "waiting" ? task.question?.question ?? task.title : task.title;
      const n = new Notification(task.status === "waiting" ? "Forgeboard · ?" : "Forgeboard · ✓", { body, tag: task.id });
      n.onclick = () => {
        window.focus();
        window.location.href = `/runs/${task.id}`;
      };
    }
  }, [tasks, notify]);

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

  const agentOf = useCallback(
    (id: AgentId, workspaceId?: string) =>
      (workspaceId ? crews[workspaceId]?.find((a) => a.id === id) : undefined) ?? crews.default?.find((a) => a.id === id),
    [crews],
  );
  // A deleted agent still shows in old runs: fall back to its id, capitalized ("forge" → "Forge").
  const agentName = useCallback(
    (id: AgentId, workspaceId?: string) => agentOf(id, workspaceId)?.name || id.charAt(0).toUpperCase() + id.slice(1),
    [agentOf],
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
      agentOf,
      flows,
      refreshFlows,
      teams,
      refreshTeams,
      refreshCrews,
      lastRepoId,
      rememberRepo,
      newWorkspaceOpen,
      setNewWorkspaceOpen,
      serverDown,
      locked,
      notify,
      setNotify,
      loaded,
    }),
    [workspaces, refreshWorkspaces, repos, refreshRepos, tasks, refreshTasks, providers, crews, agentName, agentOf, flows, refreshFlows, teams, refreshTeams, refreshCrews, lastRepoId, rememberRepo, newWorkspaceOpen, serverDown, locked, notify, setNotify, loaded],
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

/** What a workspace's team works on: code unless it uses a team for other work. */
export function useWorkKind(workspaceId?: string): WorkKind {
  const scoped = useWorkspaceScope();
  const { workspaces, teams } = useAppState();
  const ws = workspaces.find((w) => w.id === (workspaceId ?? scoped));
  const team = ws?.crewMode === "team" ? teams.find((t) => t.id === ws.teamId) : undefined;
  return team?.kind ?? "code";
}

/** Outside code, results are accepted rather than merged. */
export function useAcceptWords(workspaceId?: string): boolean {
  return useWorkKind(workspaceId) !== "code";
}
