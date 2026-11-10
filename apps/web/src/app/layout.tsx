import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Sidebar } from "@/components/sidebar";
import { AppStateProvider } from "@/lib/app-state";
import "./globals.css";

export const metadata: Metadata = {
  title: "Forgeboard",
  description: "Local cockpit for AI coding agents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <AppStateProvider>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </AppStateProvider>
      </body>
    </html>
  );
}
