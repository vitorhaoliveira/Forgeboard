import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { NewWorkspaceDialog } from "@/components/new-workspace-dialog";
import { Rail } from "@/components/rail";
import { ServerBanner } from "@/components/server-banner";
import { AppStateProvider } from "@/lib/app-state";
import "./globals.css";

export const metadata: Metadata = {
  title: "Forgeboard",
  description: "Your crew of AI coding agents, on your machine.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AppStateProvider>
            <div className="flex min-h-screen">
              <Rail />
              <div className="flex min-w-0 grow flex-col">
                <ServerBanner />
                {children}
              </div>
            </div>
            <NewWorkspaceDialog />
          </AppStateProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
