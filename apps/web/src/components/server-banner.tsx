"use client";

import { useTranslations } from "next-intl";
import { API_URL, IS_DEMO } from "@/lib/api";
import { useAppState } from "@/lib/app-state";

export function ServerBanner() {
  const t = useTranslations("common");
  const td = useTranslations("demo");
  const { serverDown } = useAppState();
  if (IS_DEMO) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-accent/25 bg-accent/[0.06] px-7 py-2 text-[12.5px] text-[#fdba74]">
        <span>{td("banner")}</span>
        <a href="https://github.com/vitorhaoliveira/Forgeboard" className="font-medium text-accent underline-offset-2 hover:underline">
          {td("github")}
        </a>
      </div>
    );
  }
  if (!serverDown) return null;
  return (
    <div role="alert" className="border-b border-danger/30 bg-danger/10 px-7 py-2 text-[13px] text-danger">
      {t("serverDown", { url: API_URL })}
    </div>
  );
}
