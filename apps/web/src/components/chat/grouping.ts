/**
 * Pure helpers for chat timelines: day dividers, sender grouping and the
 * scroll anchoring used when older history is prepended.
 */
import type { Message } from "@open-social/types";
import { dayLabel, sameDay } from "@/lib/time";

export const GROUP_GAP_MS = 5 * 60_000;

export type ChatRow =
  | { type: "day"; key: string; label: string }
  | { type: "message"; key: string; message: Message; firstInGroup: boolean; lastInGroup: boolean };

/**
 * Rows for a timeline given messages OLDEST FIRST. Consecutive messages from
 * the same sender within GROUP_GAP_MS (and on the same day) form one group.
 */
export function buildRows(messages: Message[], now: number = Date.now(), gapMs = GROUP_GAP_MS): ChatRow[] {
  const rows: ChatRow[] = [];
  let prev: Message | null = null;
  messages.forEach((m, i) => {
    const at = new Date(m.createdAt);
    const newDay = !prev || !sameDay(new Date(prev.createdAt), at);
    if (newDay) rows.push({ type: "day", key: `day-${m.createdAt.slice(0, 10)}-${m.id}`, label: dayLabel(at, now) });
    const next = messages[i + 1];
    const startsGroup = newDay || !prev || prev.sender.id !== m.sender.id || at.getTime() - new Date(prev.createdAt).getTime() > gapMs;
    const endsGroup =
      !next ||
      next.sender.id !== m.sender.id ||
      !sameDay(new Date(next.createdAt), at) ||
      new Date(next.createdAt).getTime() - at.getTime() > gapMs;
    rows.push({ type: "message", key: m.id, message: m, firstInGroup: startsGroup, lastInGroup: endsGroup });
    prev = m;
  });
  return rows;
}

/** New scrollTop that keeps the same content in view after older items were added above it. */
export function anchorAfterPrepend(prev: { scrollTop: number; scrollHeight: number }, nextScrollHeight: number): number {
  return Math.max(0, prev.scrollTop + (nextScrollHeight - prev.scrollHeight));
}

export function isNearBottom(el: { scrollTop: number; scrollHeight: number; clientHeight: number }, threshold = 120): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

/** Quick reactions offered on chat and DM messages. */
export const QUICK_REACTIONS = ["\u{1F44D}", "\u{2764}\u{FE0F}", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F64F}"] as const;
