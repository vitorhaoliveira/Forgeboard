import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";

/**
 * Optional access key for the API. The `forgeboard` command turns it on: the key lives in the
 * data folder (readable only by you), the terminal prints a link with it, and the browser keeps it
 * in an HttpOnly cookie. Other people and programs on this machine can't use the API without it.
 */
export const auth = {
  token: null as string | null,
  cookieName: "fb_token",
};

/** Reads the key from the data folder, creating it the first time. */
export function enableAuth(): string {
  mkdirSync(config.dataDir, { recursive: true });
  const file = join(config.dataDir, "access-key");
  let token = existsSync(file) ? readFileSync(file, "utf8").trim() : "";
  if (token.length < 32) {
    token = randomBytes(24).toString("base64url");
    writeFileSync(file, `${token}\n`, { mode: 0o600 });
  }
  try {
    chmodSync(file, 0o600);
  } catch {
    // not supported on every filesystem
  }
  auth.token = token;
  // Cookies ignore ports, so each port gets its own cookie.
  auth.cookieName = `fb_token_${config.port}`;
  return token;
}

export function matchesToken(candidate: string | undefined | null): boolean {
  if (!auth.token || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(auth.token);
  return a.length === b.length && timingSafeEqual(a, b);
}
