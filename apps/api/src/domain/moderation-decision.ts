/**
 * Turning classifier scores into an outcome. Pure, so the policy is unit-testable and
 * the same for every provider (OpenAI, rules, the test stub).
 *
 *   CLEAN   nothing reached a review threshold
 *   REVIEW  the item stays visible and a case enters the moderation queue
 *   HIDE    the item is hidden at once, a case opens, and the author may appeal
 *
 * Thresholds come from platform settings (settings.moderation.thresholds), 0..1 per
 * category. Categories with no threshold are ignored.
 */
export type Thresholds = Record<string, { review: number; hide: number }>;

export interface ModerationContext {
  /** Open user reports already filed against the item. */
  reportCount: number;
  /** The author's reputation and account age, for trust adjustments. */
  authorReputation: number;
  authorAccountAgeDays: number;
  /** Staff content is never auto-hidden (it still gets a review case). */
  authorIsStaff: boolean;
}

export type Verdict =
  | { outcome: "CLEAN"; categories: []; priority: 0 }
  | { outcome: "REVIEW" | "HIDE"; categories: string[]; priority: number };

/** The baseline: compare each score to its thresholds, the strongest category wins. */
export function baselineVerdict(scores: Record<string, number>, thresholds: Thresholds): Verdict {
  const hide: string[] = [];
  const review: string[] = [];
  let top = 0;
  for (const [category, score] of Object.entries(scores)) {
    const t = thresholds[category];
    if (!t || !Number.isFinite(score)) continue;
    if (score >= t.hide) hide.push(category);
    else if (score >= t.review) review.push(category);
    if (score >= t.review) top = Math.max(top, score);
  }
  if (hide.length) return { outcome: "HIDE", categories: [...hide, ...review], priority: Math.round(top * 100) };
  if (review.length) return { outcome: "REVIEW", categories: review, priority: Math.round(top * 100) };
  return { outcome: "CLEAN", categories: [], priority: 0 };
}

export function decideModeration(scores: Record<string, number>, thresholds: Thresholds, ctx: ModerationContext): Verdict {
  const verdict = baselineVerdict(scores, thresholds);
  return adjustForContext(verdict, ctx);
}

/**
 * Context adjustments on top of the per-category thresholds. This is where policy
 * lives that a single score cannot express, for example:
 *   - staff content never auto-hides (downgrade HIDE to REVIEW)
 *   - user reports corroborate the classifier (raise priority, or REVIEW -> HIDE)
 *   - brand-new accounts get less benefit of the doubt than established members
 *
 * Today only the first rule is applied. Deployments that want the others add them here;
 * the function is pure, so tests/unit can pin any policy you choose.
 */
export function adjustForContext(verdict: Verdict, ctx: ModerationContext): Verdict {
  if (ctx.authorIsStaff && verdict.outcome === "HIDE") return { ...verdict, outcome: "REVIEW" };
  return verdict;
}
