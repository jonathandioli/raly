import { createHash, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "raly_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

/**
 * The cookie holds a hash of the password, not the password. Changing DASHBOARD_PASSWORD
 * changes the hash, which signs everyone out.
 */
export function sessionToken(password: string): string {
  return createHash("sha256").update(`raly-session:${password}`).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Only allow redirects back into this app after login. */
export function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
