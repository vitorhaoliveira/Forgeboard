"use client";

import { useTranslations } from "next-intl";
import { API_URL } from "@/lib/api";
import { useAppState } from "@/lib/app-state";

export function ServerBanner() {
  const t = useTranslations("common");
  const { serverDown } = useAppState();
  if (!serverDown) return null;
  return (
    <div role="alert" className="border-b border-danger/30 bg-danger/10 px-7 py-2 text-[13px] text-danger">
      {t("serverDown", { url: API_URL })}
    </div>
  );
}
