"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Activity, Hammer, Inbox, SlidersHorizontal, Users, Workflow } from "lucide-react";
import type { Locale } from "@forgeboard/shared";
import { setLocale } from "@/lib/locale-action";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", key: "desk", icon: Inbox, match: (p: string) => p === "/" },
  { href: "/flows", key: "flows", icon: Workflow, match: (p: string) => p.startsWith("/flows") },
  { href: "/runs", key: "runs", icon: Activity, match: (p: string) => p.startsWith("/runs") },
  { href: "/crew", key: "crew", icon: Users, match: (p: string) => p.startsWith("/crew") },
] as const;

const itemClass = "grid size-10 place-items-center rounded-[10px] text-muted transition hover:bg-panel-2 hover:text-text";

export function Rail() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("nav");
  const locale = useLocale() as Locale;
  const [pending, startTransition] = useTransition();

  function toggleLocale() {
    startTransition(async () => {
      await setLocale(locale === "pt-BR" ? "en-US" : "pt-BR");
      router.refresh();
    });
  }

  return (
    <nav
      aria-label={t("main")}
      className="sticky top-0 flex h-screen w-16 shrink-0 flex-col items-center gap-1.5 border-r border-border bg-panel py-3.5"
    >
      <Link href="/" aria-label="Forgeboard" className="mb-3.5 grid size-[34px] place-items-center rounded-[9px] bg-text text-bg">
        <Hammer className="size-[18px]" aria-hidden="true" />
      </Link>
      {items.map(({ href, key, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={key}
            href={href}
            aria-label={t(key)}
            title={t(key)}
            aria-current={active ? "page" : undefined}
            className={cn(itemClass, active && "bg-panel-2 text-text shadow-[inset_0_0_0_1px_var(--border)]")}
          >
            <Icon className="size-[19px]" aria-hidden="true" />
          </Link>
        );
      })}
      <span className="grow" />
      <button
        type="button"
        onClick={toggleLocale}
        disabled={pending}
        aria-label={t("switchLanguage")}
        title={t("language")}
        className={cn(itemClass, "text-[11px] font-semibold tracking-[0.04em]")}
      >
        {t("short")}
      </button>
      <Link
        href="/settings"
        aria-label={t("settings")}
        title={t("settings")}
        aria-current={pathname.startsWith("/settings") ? "page" : undefined}
        className={cn(itemClass, pathname.startsWith("/settings") && "bg-panel-2 text-text")}
      >
        <SlidersHorizontal className="size-[19px]" aria-hidden="true" />
      </Link>
    </nav>
  );
}
