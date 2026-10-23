/**
 * @mentions in post and comment bodies. A mention is "@" followed by a username
 * (3 to 30 letters, digits or underscores) that is not glued to a preceding word, so
 * email addresses ("someone@example.com") are not mentions.
 */
export const MAX_MENTIONS = 20;

const MENTION = /(^|[^\w@./])@([a-zA-Z0-9_]{3,30})(?![a-zA-Z0-9_])/g;

/** Unique, lower-cased usernames in order of first appearance. */
export function parseMentions(body: string | null | undefined, max = MAX_MENTIONS): string[] {
  if (!body) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(MENTION)) {
    const name = (m[2] as string).toLowerCase();
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

/** Mentions present in `next` but not in `previous` (only new mentions notify on edit). */
export function newMentions(previous: string | null | undefined, next: string | null | undefined): string[] {
  const before = new Set(parseMentions(previous));
  return parseMentions(next).filter((u) => !before.has(u));
}
