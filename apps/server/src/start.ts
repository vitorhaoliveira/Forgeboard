import { serve } from "@hono/node-server";
import { setCookie } from "hono/cookie";
import { proxy } from "hono/proxy";
import { app } from "./app.js";
import { auth, enableAuth, matchesToken } from "./auth.js";
import { config } from "./config.js";
import { failInterruptedTasks } from "./db.js";

export interface StartOptions {
  /** Address of the web app to serve on the same port (used by the `forgeboard` command). */
  webUpstream?: string;
  /** Require the access key from the data folder (see auth.ts). */
  requireKey?: boolean;
  /** Called with the plain URL and, when a key is required, the URL that signs the browser in. */
  onListening?: (url: string, signInUrl: string) => void;
}

/** Starts the API. With `webUpstream`, every non-API request is passed to the web app. */
export function startServer(options: StartOptions = {}) {
  const interrupted = failInterruptedTasks();
  if (interrupted > 0) console.log(`Marked ${interrupted} interrupted task(s) as error.`);

  const token = options.requireKey ? enableAuth() : null;

  const upstream = options.webUpstream;
  if (upstream) {
    app.all("*", (c) => {
      const url = new URL(c.req.url);
      if (url.pathname.startsWith("/api/")) return c.json({ error: "Not found" }, 404);
      // The link from the terminal: keep the key in an HttpOnly cookie and drop it from the address bar.
      const key = url.searchParams.get("token");
      if (key !== null && c.req.method === "GET") {
        if (matchesToken(key)) {
          setCookie(c, auth.cookieName, key, { httpOnly: true, sameSite: "Strict", path: "/", maxAge: 60 * 60 * 24 * 365 });
        }
        url.searchParams.delete("token");
        return c.redirect(`${url.pathname}${url.search}`, 302);
      }
      // fetch sends the upstream's Host; Next checks Origin against x-forwarded-host for server actions.
      return proxy(`${upstream}${url.pathname}${url.search}`, {
        raw: c.req.raw,
        headers: { ...c.req.header(), "x-forwarded-host": url.host, "x-forwarded-proto": url.protocol.replace(":", "") },
      });
    });
  }

  return serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    const url = `http://${config.host === "127.0.0.1" ? "localhost" : config.host}:${info.port}`;
    if (options.onListening) options.onListening(url, token ? `${url}/?token=${token}` : url);
    else {
      console.log(`Forgeboard server on http://${config.host}:${info.port}`);
      console.log(`Data: ${config.dataDir}`);
    }
  });
}
