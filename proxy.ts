import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, safeEqual, sessionToken } from "@/lib/auth";

// Password gate for the dashboard. Set DASHBOARD_PASSWORD on Vercel; visitors without the
// session cookie are sent to /login. The cron route checks CRON_SECRET itself.
export function proxy(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();
  const cookie = req.cookies.get(SESSION_COOKIE)?.value ?? "";
  if (cookie && safeEqual(cookie, sessionToken(password))) return NextResponse.next();

  const login = new URL("/login", req.url);
  const next = req.nextUrl.pathname + req.nextUrl.search;
  if (next !== "/") login.searchParams.set("next", next);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!login|api/cron|_next/static|_next/image|favicon.ico).*)"],
};
