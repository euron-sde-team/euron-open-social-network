import { isApiError } from "@open-social/api-client";

/** Copy for a failed data export. */
export function exportErrorMessage(e: unknown, fallback: (e: unknown) => string): string {
  if (isApiError(e) && e.status === 429) return "You can export 3 times a day. Try again tomorrow.";
  return fallback(e);
}

/**
 * Communities that block deletion (409 OWNER_MUST_TRANSFER). The API lists
 * them in `details.communities` when it can; an empty array means "some".
 */
export function ownedCommunities(e: unknown): { name: string; slug?: string }[] | null {
  if (!isApiError(e) || e.code !== "OWNER_MUST_TRANSFER") return null;
  const list = (e.details as { communities?: unknown } | null | undefined)?.communities;
  if (!Array.isArray(list)) return [];
  return list.flatMap((c) => {
    if (typeof c === "string") return [{ name: c }];
    if (c && typeof c === "object" && typeof (c as { name?: unknown }).name === "string") {
      const slug = (c as { slug?: unknown }).slug;
      return [{ name: (c as { name: string }).name, ...(typeof slug === "string" ? { slug } : {}) }];
    }
    return [];
  });
}
