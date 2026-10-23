/**
 * Hashtags and search text.
 *
 * Tags come from two places: an explicit `tags` list and #hashtags in the body. Both are
 * normalised the same way (lower case, 1 to 40 letters, digits or underscores, at least
 * one letter) and capped, so "#Design" and tags: ["design"] are the same tag.
 *
 * Search uses the tsvector columns in the schema. User text becomes a prefix tsquery
 * built only from word characters, so no query syntax from the client ever reaches
 * to_tsquery.
 */
export const MAX_TAGS = 10;
export const TRENDING_DAYS = 14;

const TAG = /^[a-z0-9_]{1,40}$/;
const HASHTAG = /(^|[^\w#&/])#([a-zA-Z0-9_]{1,40})(?![a-zA-Z0-9_])/g;

export function normalizeTag(raw: string): string | null {
  const t = raw.trim().replace(/^#/, "").toLowerCase();
  if (!TAG.test(t) || !/[a-z]/.test(t)) return null;
  return t;
}

export function parseHashtags(body: string | null | undefined): string[] {
  if (!body) return [];
  const out: string[] = [];
  for (const m of body.matchAll(HASHTAG)) {
    const t = normalizeTag(m[2] as string);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Explicit tags first, then body hashtags, deduplicated and capped. */
export function collectTags(explicit: readonly string[] | null | undefined, body: string | null | undefined, max = MAX_TAGS): string[] {
  const out: string[] = [];
  for (const raw of [...(explicit ?? []), ...parseHashtags(body)]) {
    const t = normalizeTag(raw);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Words of a search query: letters and digits only, lower-cased, at most 8. */
export function searchTerms(q: string): string[] {
  return (q.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).slice(0, 8);
}

/** "data sci" -> "data:* & sci:*", or null when nothing searchable remains. */
export function prefixTsQuery(q: string): string | null {
  const terms = searchTerms(q);
  if (!terms.length) return null;
  return terms.map((t) => `${t}:*`).join(" & ");
}

/** Escape LIKE wildcards so user text is matched literally (trigram indexes serve ILIKE). */
export function likeContains(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
