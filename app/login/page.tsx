import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_MAX_AGE, safeEqual, safeNext, sessionToken } from "@/lib/auth";

async function login(formData: FormData) {
  "use server";
  const password = process.env.DASHBOARD_PASSWORD ?? "";
  const next = safeNext(formData.get("next"));
  const attempt = String(formData.get("password") ?? "");
  if (!password || !safeEqual(sessionToken(attempt), sessionToken(password))) {
    redirect(`/login?error=1${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`);
  }
  (await cookies()).set({
    name: SESSION_COOKIE,
    value: sessionToken(password),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect(next);
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="font-serif text-3xl font-semibold tracking-tight">Aly&apos;s Rally</h1>
      <form action={login} className="mt-6 space-y-3">
        <input type="hidden" name="next" value={next} />
        <input
          type="password"
          name="password"
          placeholder="Password"
          autoFocus
          required
          autoComplete="current-password"
          className="w-full rounded-md border border-line bg-card px-3 py-2 outline-none focus:ring-2 focus:ring-ink/20"
        />
        {sp.error && <p className="text-sm text-flag">That password didn&apos;t work.</p>}
        <button type="submit" className="w-full rounded-md bg-ink px-3 py-2 text-sm font-medium text-paper hover:opacity-90">
          Sign in
        </button>
      </form>
    </main>
  );
}
