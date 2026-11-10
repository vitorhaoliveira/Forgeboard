"use server";

import { cookies } from "next/headers";
import { LOCALES, type Locale } from "@forgeboard/shared";
import { LOCALE_COOKIE } from "@/i18n/request";

export async function setLocale(locale: Locale) {
  if (!LOCALES.includes(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}
