/**
 * Unread math, kept in one place so the per-thread badge and the inbox totals cannot
 * disagree (the source system counted them with two different queries).
 *
 * A message is unread for a participant when it is newer than their read cursor
 * (or, never having read, newer than when they joined), they did not send it, and it is
 * still PUBLISHED. The SQL in the repositories implements `isUnread`; the tests pin the
 * definition.
 */
export interface UnreadCandidate {
  senderId: string;
  status: string;
  createdAt: Date;
}

export function isUnread(m: UnreadCandidate, viewerId: string, readCursor: Date | null, joinedAt: Date): boolean {
  if (m.senderId === viewerId || m.status !== "PUBLISHED") return false;
  return m.createdAt.getTime() > (readCursor ?? joinedAt).getTime();
}

export interface ThreadUnread {
  state: "ACTIVE" | "REQUESTED" | "DECLINED" | "LEFT";
  unread: number;
  mutedUntil: Date | null;
}

/**
 * The /dms/unread badge: `inbox` is unread messages in accepted threads that are not
 * muted right now; `requests` is the number of pending requests with something unread.
 */
export function inboxTotals(threads: ThreadUnread[], now = new Date()): { inbox: number; requests: number } {
  let inbox = 0;
  let requests = 0;
  for (const t of threads) {
    if (t.unread <= 0) continue;
    if (t.state === "ACTIVE" && !(t.mutedUntil && t.mutedUntil > now)) inbox += t.unread;
    else if (t.state === "REQUESTED") requests += 1;
  }
  return { inbox, requests };
}
