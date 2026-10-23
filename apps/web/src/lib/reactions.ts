import { REACTIONS, type ReactionCounts, type ReactionType } from "@open-social/types";

export interface ReactionMeta {
  type: ReactionType;
  label: string;
  emoji: string;
  /** Text colour class for the active state of the Like button. */
  tone: string;
}

export const REACTION_META: Record<ReactionType, ReactionMeta> = {
  LIKE: { type: "LIKE", label: "Like", emoji: "\u{1F44D}", tone: "text-primary-soft-foreground" },
  LOVE: { type: "LOVE", label: "Love", emoji: "\u{2764}\u{FE0F}", tone: "text-reaction-love" },
  CARE: { type: "CARE", label: "Care", emoji: "\u{1F917}", tone: "text-reaction-warm" },
  HAHA: { type: "HAHA", label: "Haha", emoji: "\u{1F606}", tone: "text-reaction-warm" },
  WOW: { type: "WOW", label: "Wow", emoji: "\u{1F62E}", tone: "text-reaction-warm" },
  SAD: { type: "SAD", label: "Sad", emoji: "\u{1F622}", tone: "text-reaction-warm" },
  ANGRY: { type: "ANGRY", label: "Angry", emoji: "\u{1F621}", tone: "text-reaction-angry" },
};

export const REACTION_LIST: ReactionMeta[] = REACTIONS.map((r) => REACTION_META[r]);

/** A click on the main button: with any reaction set it removes it; with none, it likes. */
export function toggleTarget(current: ReactionType | null): ReactionType | null {
  return current ? null : "LIKE";
}

/** Optimistic counts after changing the viewer's reaction from `prev` to `next`. */
export function applyReaction(
  state: { reactionCount: number; reactionCounts: ReactionCounts },
  prev: ReactionType | null,
  next: ReactionType | null,
): { reactionCount: number; reactionCounts: ReactionCounts } {
  if (prev === next) return state;
  const counts: ReactionCounts = { ...state.reactionCounts };
  let total = state.reactionCount;
  if (prev) {
    const v = (counts[prev] ?? 0) - 1;
    if (v > 0) counts[prev] = v;
    else delete counts[prev];
    total = Math.max(0, total - 1);
  }
  if (next) {
    counts[next] = (counts[next] ?? 0) + 1;
    total += 1;
  }
  return { reactionCount: total, reactionCounts: counts };
}

/** The top N reaction types by count, for the stacked icons on the counts row. */
export function topReactions(counts: ReactionCounts, n = 3): ReactionType[] {
  return (Object.entries(counts) as [ReactionType, number][])
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1] || REACTIONS.indexOf(a[0]) - REACTIONS.indexOf(b[0]))
    .slice(0, n)
    .map(([t]) => t);
}

/**
 * Picker open/close state machine: hover intent with delays so moving the
 * pointer from the button to the picker does not close it, long-press on touch,
 * and keyboard open via ArrowUp or Enter-and-hold equivalents.
 */
export type PickerState = { open: boolean; pending: "open" | "close" | null };
export type PickerEvent = "pointer-enter" | "pointer-leave" | "long-press" | "open-timer" | "close-timer" | "pick" | "escape" | "toggle-key";

export function pickerReducer(state: PickerState, event: PickerEvent): PickerState {
  switch (event) {
    case "pointer-enter":
      return state.open ? { open: true, pending: null } : { open: false, pending: "open" };
    case "pointer-leave":
      return state.open ? { open: true, pending: "close" } : { open: false, pending: null };
    case "open-timer":
      return state.pending === "open" ? { open: true, pending: null } : state;
    case "close-timer":
      return state.pending === "close" ? { open: false, pending: null } : state;
    case "long-press":
      return { open: true, pending: null };
    case "toggle-key":
      return { open: !state.open, pending: null };
    case "pick":
    case "escape":
      return { open: false, pending: null };
    default:
      return state;
  }
}

export const PICKER_OPEN_DELAY = 450;
export const PICKER_CLOSE_DELAY = 300;
export const LONG_PRESS_MS = 420;
