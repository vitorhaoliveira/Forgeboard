"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, Eye, FilePen, Loader2 } from "lucide-react";
import type { PermissionMode, ProviderId } from "@forgeboard/shared";
import { api } from "@/lib/api";
import { useAppState } from "@/lib/app-state";
import { cn } from "@/lib/utils";
import { Button, Kbd } from "./ui";

const modes: { id: PermissionMode; label: string; hint: string; icon: typeof Eye }[] = [
  { id: "plan", label: "Read only", hint: "The agent explores and proposes a plan. No files change.", icon: Eye },
  {
    id: "acceptEdits",
    label: "Can edit files",
    hint: "The agent edits files directly in this repository. Commit your work first.",
    icon: FilePen,
  },
];

export function NewTaskForm() {
  const router = useRouter();
  const { selectedRepo, providers, refreshTasks, serverError } = useAppState();
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState<ProviderId>("claude-code");
  const [mode, setMode] = useState<PermissionMode>("plan");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fall back to the mock provider when Claude Code isn't installed.
  useEffect(() => {
    const current = providers.find((p) => p.id === provider);
    if (current && !current.available) {
      const fallback = providers.find((p) => p.available);
      if (fallback) setProvider(fallback.id);
    }
  }, [providers, provider]);

  const canSubmit = Boolean(selectedRepo && prompt.trim() && !submitting);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!selectedRepo || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const task = await api.createTask({
        repoId: selectedRepo.id,
        prompt: prompt.trim(),
        provider,
        permissionMode: mode,
      });
      void refreshTasks();
      router.push(`/tasks/${task.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col justify-center px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">What should the agent build?</h1>
      <p className="mt-1 text-sm text-muted">
        {selectedRepo ? (
          <>
            Working in <span className="font-mono text-text">{selectedRepo.name}</span>
          </>
        ) : (
          "Add a repository in the sidebar to get started."
        )}
      </p>

      {serverError && (
        <div className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {serverError} Start it with <code className="font-mono">pnpm dev</code>.
        </div>
      )}

      <form onSubmit={submit} className="mt-6 rounded-xl border border-border bg-panel shadow-sm focus-within:border-accent/60">
        <label htmlFor="prompt" className="sr-only">
          Task description
        </label>
        <textarea
          id="prompt"
          autoFocus
          rows={5}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!selectedRepo}
          placeholder="e.g. Add pagination to the users table and cover it with tests"
          className="block w-full resize-none rounded-t-xl bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted"
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
          <label htmlFor="provider" className="sr-only">
            Agent
          </label>
          <select
            id="provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderId)}
            className="rounded-md border border-border bg-panel-2 px-2 py-1 text-xs outline-none focus:border-accent"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.available}>
                {p.label}
                {!p.available ? " (not installed)" : ""}
              </option>
            ))}
          </select>

          <div role="radiogroup" aria-label="Permissions" className="flex rounded-md border border-border bg-panel-2 p-0.5">
            {modes.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                title={m.hint}
                onClick={() => setMode(m.id)}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs",
                  mode === m.id ? "bg-panel text-text shadow-sm" : "text-muted hover:text-text",
                )}
              >
                <m.icon className="size-3.5" />
                {m.label}
              </button>
            ))}
          </div>

          <span className="ml-auto hidden items-center gap-1 text-[11px] text-muted sm:inline-flex">
            <Kbd>⌘</Kbd>
            <Kbd>Enter</Kbd>
          </span>
          <Button type="submit" variant="primary" disabled={!canSubmit} aria-label="Run task">
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
            Run
          </Button>
        </div>
      </form>

      <p className="mt-2 text-xs text-muted">{modes.find((m) => m.id === mode)?.hint}</p>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
