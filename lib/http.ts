const CONTACT = process.env.CONTACT_EMAIL || "unset@example.com";
export const USER_AGENT = `aly-job/1.0 (L&D job aggregator; contact ${CONTACT})`;

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
  ) {
    super(`HTTP ${status} for ${redact(url)}`);
  }
}

// Keys travel in query strings for Adzuna/SerpApi; keep them out of logs and the report footer.
export function redact(url: string): string {
  return url.replace(/((?:app_id|app_key|api_key|key)=)[^&]+/gi, "$1***");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET JSON with a descriptive User-Agent, a timeout, and backoff on 429/5xx. */
export async function getJson<T>(url: string, headers: Record<string, string> = {}, attempts = 4): Promise<T> {
  for (let i = 0; ; i++) {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return (await res.json()) as T;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || i >= attempts - 1) throw new HttpError(res.status, url);
    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** i);
  }
}

/** Run fn over items with at most `limit` in flight. */
export async function pMap<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
