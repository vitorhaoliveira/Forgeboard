"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Activity, Hammer, Inbox, Plus, SlidersHorizontal, Users, Workflow } from "lucide-react";
import { needsYou, type Locale } from "@forgeboard/shared";
import { useAppState } from "@/lib/app-state";
import { setLocale } from "@/lib/locale-action";
import { cn } from "@/lib/utils";
import { initial, WS_TEXT } from "./workspace-ui";

const itemClass = "grid size-10 place-items-center rounded-[10px] text-muted transition hover:bg-panel-2 hover:text-text";
const tileClass = "relative grid size-[42px] place-items-center rounded-[13px] border border-border bg-glyph text-base font-bold transition hover:border-border-strong";

function Badge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="absolute -top-[5px] -right-1.5 grid h-[19px] min-w-[19px] place-items-center rounded-[10px] border-2 border-panel bg-accent px-[5px] text-[10.5px] font-bold text-bg">
      {count}
    </span>
  );
}

function ActivePill() {
  return <span aria-hidden="true" className="absolute top-[11px] -left-[16px] h-5 w-1 rounded-r bg-text" />;
}

export function Rail() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("nav");
  const tw = useTranslations("ws");
  const locale = useLocale() as Locale;
  const [pending, startTransition] = useTransition();
  const { activeWorkspaces, tasks, setNewWorkspaceOpen } = useAppState();

  const waitingIn = (wsId?: string) => tasks.filter((x) => needsYou(x.status) && (!wsId || x.workspaceId === wsId)).length;
  const allActive = pathname === "/";

  function toggleLocale() {
    startTransition(async () => {
      await setLocale(locale === "pt-BR" ? "en-US" : "pt-BR");
      router.refresh();
    });
  }

  const nav = [
    { href: "/runs", key: "runs", icon: Activity },
    { href: "/flows", key: "flows", icon: Workflow },
    { href: "/crew", key: "crew", icon: Users },
  ] as const;

  return (
    <nav
      aria-label={t("main")}
      className="sticky top-0 flex h-screen w-[72px] shrink-0 flex-col items-center gap-2.5 overflow-y-auto border-r border-border bg-panel py-3.5"
    >
      <Link href="/" aria-label="Forgeboard" className="mb-1.5 grid size-[34px] shrink-0 place-items-center rounded-[9px] bg-text text-bg">
        <Hammer className="size-[18px]" aria-hidden="true" />
      </Link>

      <Link
        href="/"
        aria-label={tw("tileLabel", { name: tw("all"), count: waitingIn() })}
        title={tw("allShort")}
        aria-current={allActive ? "page" : undefined}
        className={cn(tileClass, "shrink-0 text-text", allActive && "border-border-strong bg-panel-2")}
      >
        {allActive && <ActivePill />}
        <Inbox className="size-[18px]" aria-hidden="true" />
        <Badge count={waitingIn()} />
      </Link>
      <span className="h-px w-7 shrink-0 bg-border" />

      {activeWorkspaces.map((ws) => {
        const active = pathname === `/w/${ws.id}` || pathname.startsWith(`/w/${ws.id}/`);
        const count = waitingIn(ws.id);
        return (
          <Link
            key={ws.id}
            href={`/w/${ws.id}`}
            aria-label={tw("tileLabel", { name: ws.name, count })}
            title={ws.name}
            aria-current={active ? "page" : undefined}
            className={cn(tileClass, "shrink-0", WS_TEXT[ws.color], active && "border-border-strong bg-panel-2")}
          >
            {active && <ActivePill />}
            {initial(ws.name)}
            <Badge count={count} />
          </Link>
        );
      })}
      <button
        type="button"
        onClick={() => setNewWorkspaceOpen(true)}
        aria-label={tw("create")}
        title={tw("create")}
        className={cn(tileClass, "shrink-0 border-dashed bg-transparent text-muted hover:text-text")}
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>

      <span className="grow" />
      {nav.map(({ href, key, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={key}
            href={href}
            aria-label={t(key)}
            title={t(key)}
            aria-current={active ? "page" : undefined}
            className={cn(itemClass, "shrink-0", active && "bg-panel-2 text-text")}
          >
            <Icon className="size-[19px]" aria-hidden="true" />
          </Link>
        );
      })}
      <button
        type="button"
        onClick={toggleLocale}
        disabled={pending}
        aria-label={t("switchLanguage")}
        title={t("language")}
        className={cn(itemClass, "shrink-0 text-[11px] font-semibold tracking-[0.04em]")}
      >
        {t("short")}
      </button>
      <Link
        href="/settings"
        aria-label={t("settings")}
        title={t("settings")}
        aria-current={pathname.startsWith("/settings") ? "page" : undefined}
        className={cn(itemClass, "shrink-0", pathname.startsWith("/settings") && "bg-panel-2 text-text")}
      >
        <SlidersHorizontal className="size-[19px]" aria-hidden="true" />
      </Link>
    </nav>
  );
}
