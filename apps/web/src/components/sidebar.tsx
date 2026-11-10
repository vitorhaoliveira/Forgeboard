"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type FormEvent } from "react";
import { FolderGit2, Hammer, Plus } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { cn, timeAgo } from "@/lib/utils";
import { StatusDot } from "./status-badge";

export function Sidebar() {
  const pathname = usePathname();
  const { repos, selectedRepo, selectRepo, addRepo, tasks } = useAppState();
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  const repoTasks = selectedRepo ? tasks.filter((t) => t.repoId === selectedRepo.id) : [];

  async function onAddRepo(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await addRepo(path);
      setPath("");
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-panel">
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="grid size-7 place-items-center rounded-md bg-accent text-accent-fg">
          <Hammer className="size-4" />
        </div>
        <span className="font-semibold tracking-tight">Forgeboard</span>
        <span className="ml-auto rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">v0</span>
      </div>

      {/* Repository picker */}
      <div className="border-y border-border px-3 py-3">
        <label htmlFor="repo" className="mb-1.5 block text-xs font-medium text-muted">
          Repository
        </label>
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <FolderGit2 className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted" />
            <select
              id="repo"
              value={selectedRepo?.id ?? ""}
              onChange={(e) => selectRepo(e.target.value)}
              disabled={repos.length === 0}
              className="w-full appearance-none rounded-md border border-border bg-panel-2 py-1.5 pr-2 pl-7 text-sm outline-none focus:border-accent"
            >
              {repos.length === 0 && <option value="">No repositories yet</option>}
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            aria-label="Add repository"
            title="Add repository"
            className="grid size-8 place-items-center rounded-md border border-border bg-panel-2 text-muted hover:text-text"
          >
            <Plus className="size-4" />
          </button>
        </div>
        {selectedRepo && !adding && (
          <p className="mt-1.5 truncate font-mono text-[11px] text-muted" title={selectedRepo.path}>
            {selectedRepo.path}
          </p>
        )}
        {adding && (
          <form onSubmit={onAddRepo} className="mt-2 space-y-1.5">
            <input
              autoFocus
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/Users/you/projects/my-app"
              className="w-full rounded-md border border-border bg-panel-2 px-2 py-1.5 font-mono text-xs outline-none focus:border-accent"
            />
            {error && <p className="text-xs text-danger">{error}</p>}
            <div className="flex justify-end gap-1.5">
              <button type="button" onClick={() => setAdding(false)} className="px-2 py-1 text-xs text-muted">
                Cancel
              </button>
              <button type="submit" className="rounded bg-accent px-2 py-1 text-xs font-medium text-accent-fg">
                Add
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Tasks */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="text-xs font-medium text-muted">Tasks</span>
        <Link
          href="/"
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-panel-2",
            pathname === "/" ? "text-accent" : "text-muted",
          )}
        >
          <Plus className="size-3.5" /> New
        </Link>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Tasks">
        {repoTasks.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted">No tasks in this repository yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {repoTasks.map((t) => {
              const active = pathname === `/tasks/${t.id}`;
              return (
                <li key={t.id}>
                  <Link
                    href={`/tasks/${t.id}`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-start gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-panel-2",
                      active && "bg-panel-2",
                    )}
                  >
                    <StatusDot status={t.status} className="mt-1.5" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{t.title}</span>
                      <span className="block text-[11px] text-muted">{timeAgo(t.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </aside>
  );
}
