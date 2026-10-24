// Small text helpers shared by normalize, dedupe, filter and score.

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', bull: "•", hellip: "…" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** HTML (including Greenhouse's entity-escaped HTML) to readable plain text. */
export function htmlToText(html: string): string {
  let s = html;
  if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|ul|ol|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(s)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Lowercased, punctuation-free form with L&D / Sr. / Mgr spelled out, for title comparisons. */
export function normTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\bl\s*&\s*d\b|\bl\s+and\s+d\b|\blnd\b/g, " learning development ")
    .replace(/\bsr\b\.?/g, " senior ")
    .replace(/\bmgr\b\.?/g, " manager ")
    .replace(/\bassoc\b\.?/g, " associate ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(["and", "of", "the", "for", "a", "an", "in", "to"]);

export function titleTokens(title: string): Set<string> {
  return new Set(normTitle(title).split(" ").filter((t) => t && !STOP.has(t)));
}

/** Whole-phrase match on normalized text ("intern" doesn't hit "internal"). */
export function hasPhrase(normalizedText: string, phrase: string): boolean {
  const p = normTitle(phrase);
  if (!p) return false;
  // normTitle leaves only [a-z0-9 ], so p is safe to drop into a RegExp.
  return new RegExp(`(^| )${p}( |$)`).test(normalizedText);
}

export function normCompany(company: string): string {
  return company
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|plc|gmbh|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Similarity 0-100, same definition as rapidfuzz's fuzz.ratio:
 * 200 * LCS / (len(a) + len(b)), computed on characters.
 */
export function ratio(a: string, b: string): number {
  if (!a.length && !b.length) return 100;
  if (!a.length || !b.length) return 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return (200 * prev[b.length]) / (a.length + b.length);
}
