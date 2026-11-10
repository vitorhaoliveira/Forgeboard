import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Agent costs are reported in US dollars; the format follows the UI language (US$ 0,58 in pt-BR). */
export function formatCost(usd: number | null | undefined, locale: string): string {
  if (usd == null) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: usd > 0 && usd < 0.01 ? 4 : 2,
  }).format(usd);
}

export function timeAgo(iso: string, locale: string, now = Date.now()): string {
  const diff = Math.round((new Date(iso).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  const abs = Math.abs(diff);
  if (abs < 45) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

export function relativePath(path: string, root?: string): string {
  if (root && path.startsWith(root)) return path.slice(root.length).replace(/^\/+/, "");
  // Worktrees live under ~/.forgeboard/worktrees/<task>/…; show the part inside the repo.
  const m = /\/worktrees\/[^/]+\/(.+)$/.exec(path);
  return m?.[1] ?? path;
}
