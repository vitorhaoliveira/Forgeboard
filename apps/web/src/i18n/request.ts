import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@forgeboard/shared";

export const LOCALE_COOKIE = "fb-locale";

/** Picks the saved language, else the browser's, else English. */
async function resolveLocale(): Promise<Locale> {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (LOCALES.includes(saved as Locale)) return saved as Locale;
  const accept = (await headers()).get("accept-language")?.toLowerCase() ?? "";
  return accept.startsWith("pt") ? "pt-BR" : DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
