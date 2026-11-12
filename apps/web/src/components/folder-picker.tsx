"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUp, Check, ChevronRight, Folder, FolderGit2, FolderOpen, Home, Loader2, X } from "lucide-react";
import type { FolderListing } from "@forgeboard/shared";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "./ui";

/**
 * Browses folders on this machine (through the local server) to pick one, instead of typing its path.
 * Tracked folders (git repositories) are marked; a plain folder can start being tracked here.
 */
/** `lookOnly`: any folder can be chosen as it is (nothing gets tracked), for an agent that only reads it. */
export function FolderPicker({ open, onClose, onPick, lookOnly = false }: { open: boolean; onClose: () => void; onPick: (path: string) => void; lookOnly?: boolean }) {
  const t = useTranslations("folders");
  const tc = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const crumbsRef = useRef<HTMLElement>(null);
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);

  const go = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      setListing(await api.folders(path));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // Start where you left off, or at home.
      void go(listing?.path);
    } else if (!open && d.open) d.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Long paths: keep the current folder in view.
  useEffect(() => {
    const el = crumbsRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [listing?.path]);

  const track = async (path: string) => {
    setTracking(true);
    setError(null);
    try {
      await api.trackFolder(path);
      pick(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTracking(false);
    }
  };

  const pick = (path: string) => {
    onPick(path);
    onClose();
  };

  // Breadcrumb: each part of the path, clickable.
  const parts = listing ? listing.path.split("/").filter(Boolean) : [];
  const crumbs = parts.map((name, i) => ({ name, path: `/${parts.slice(0, i + 1).join("/")}` }));
  const repos = listing?.entries.filter((e) => e.isRepo).length ?? 0;

  return (
    <dialog
      ref={dialogRef}
      onClose={(e) => {
        // React passes "close" up to a dialog around this one (the new workspace dialog): keep it here.
        e.stopPropagation();
        onClose();
      }}
      onCancel={(e) => e.stopPropagation()}
      aria-labelledby="folder-picker-title"
      className="m-auto w-[min(620px,calc(100vw-32px))] rounded-[18px] border border-border-strong bg-panel p-0 text-text shadow-[0_30px_80px_rgba(0,0,0,.6)] backdrop:bg-black/60"
    >
      <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
        <FolderOpen className="size-4 text-muted" aria-hidden="true" />
        <h2 id="folder-picker-title" className="text-[15px] font-semibold">
          {t("title")}
        </h2>
        <button type="button" onClick={onClose} aria-label={tc("cancel")} className="ml-auto text-muted hover:text-text">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center gap-1.5 border-b border-border px-4 py-2">
        <Button variant="ghost" aria-label={t("home")} onClick={() => go(listing?.home)} className="px-1.5">
          <Home className="size-3.5" aria-hidden="true" />
        </Button>
        <Button variant="ghost" aria-label={t("up")} onClick={() => listing?.parent && go(listing.parent)} disabled={!listing?.parent} className="px-1.5">
          <ArrowUp className="size-3.5" aria-hidden="true" />
        </Button>
        <nav ref={crumbsRef} aria-label={t("location")} className="flex min-w-0 grow items-center overflow-x-auto font-mono text-[12px] text-muted [scrollbar-width:none]">
          <button type="button" onClick={() => go("/")} className="shrink-0 px-0.5 hover:text-text">
            /
          </button>
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex shrink-0 items-center">
              {i > 0 && <ChevronRight className="size-3" aria-hidden="true" />}
              <button type="button" onClick={() => go(c.path)} className={cn("px-0.5 hover:text-text", i === crumbs.length - 1 && "text-text")}>
                {c.name}
              </button>
            </span>
          ))}
        </nav>
        {loading && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted" aria-hidden="true" />}
      </div>

      <ul className="h-[340px] overflow-y-auto px-2 py-2" aria-label={t("folders")}>
        {error && <li className="px-3 py-2 text-[13px] text-danger">{error}</li>}
        {listing && listing.entries.length === 0 && !error && <li className="px-3 py-6 text-center text-[13px] text-muted">{t("empty")}</li>}
        {listing?.entries.map((e) => (
          <li key={e.path} className="group flex items-center gap-1 rounded-lg hover:bg-panel-2">
            <button type="button" onClick={() => go(e.path)} className="flex min-w-0 grow items-center gap-2.5 px-3 py-2 text-left text-[13px]">
              {e.isRepo ? <FolderGit2 className="size-4 shrink-0 text-accent" aria-hidden="true" /> : <Folder className="size-4 shrink-0 text-muted" aria-hidden="true" />}
              <span className="truncate">{e.name}</span>
              {e.isRepo && <span className="shrink-0 text-[11px] text-muted">{e.added ? t("added") : t("repo")}</span>}
            </button>
            {(lookOnly || (e.isRepo && !e.added)) && (
              <Button variant="ghost" onClick={() => pick(e.path)} className="mr-1 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                {t("pick")}
              </Button>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3.5">
        <p className="min-w-0 grow text-[12.5px] text-muted">
          {lookOnly
            ? t("lookOnly")
            : listing?.isRepo
            ? listing.added
              ? t("hereAdded")
              : t("hereRepo")
            : repos > 0
              ? t("reposHere", { count: repos })
              : t("notRepo")}
        </p>
        <Button variant="ghost" onClick={onClose} className="ml-auto">
          {tc("cancel")}
        </Button>
        {lookOnly ? (
          <Button variant="primary" onClick={() => listing && pick(listing.path)} disabled={!listing?.parent}>
            <Check className="size-3.5" aria-hidden="true" />
            {t("pickThis")}
          </Button>
        ) : listing && !listing.isRepo && repos === 0 && listing.parent && listing.path !== listing.home ? (
          <Button variant="primary" onClick={() => track(listing.path)} disabled={tracking}>
            {tracking ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <FolderGit2 className="size-3.5" aria-hidden="true" />}
            {tracking ? t("tracking") : t("track")}
          </Button>
        ) : (
          <Button variant="primary" onClick={() => listing && pick(listing.path)} disabled={!listing?.isRepo || listing.added}>
            <Check className="size-3.5" aria-hidden="true" />
            {t("pickThis")}
          </Button>
        )}
      </div>
    </dialog>
  );
}

/** A button that opens the folder picker. */
export function ChooseFolderButton({
  onPick,
  variant = "secondary",
  className,
  lookOnly,
}: {
  onPick: (path: string) => void;
  variant?: "primary" | "secondary";
  className?: string;
  lookOnly?: boolean;
}) {
  const t = useTranslations("folders");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)} className={className}>
        <FolderOpen className="size-3.5" aria-hidden="true" />
        {t("choose")}
      </Button>
      <FolderPicker open={open} onClose={() => setOpen(false)} onPick={onPick} lookOnly={lookOnly} />
    </>
  );
}
