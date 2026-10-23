/**
 * Moderation providers: text and images in, per-category scores (0..1) out. The policy
 * that turns scores into an outcome lives in domain/moderation-decision.ts and is the
 * same for every provider.
 *
 *   openai  POST {OPENAI_BASE_URL}/moderations (multimodal input)
 *   stub    the same client pointed at apps/moderation-stub (tests, local development)
 *   rules   no network: blocked terms, link spam and repeated messages
 *
 * Config is read at call time, not import time, so tests can start the stub on an
 * ephemeral port and point MODERATION_STUB_URL at it.
 */
import { config } from "../../core/config";

export interface ModerationInput {
  text?: string;
  imageUrls?: string[];
  /** Rules provider context: identical messages by the same author in the last 10 minutes, this one included. */
  recentDuplicates?: number;
  /** Rules provider context: the platform's blocked terms. */
  blockedTerms?: string[];
}

export interface ModerationResult {
  scores: Record<string, number>;
  flagged: boolean;
}

export interface ModerationProvider {
  name: string;
  moderate(input: ModerationInput): Promise<ModerationResult>;
}

export type ProviderName = "rules" | "openai" | "stub";

// ─── OpenAI wire format ─────────────────────────────────────────────────────

/**
 * Copy category scores as-is and fold each "parent/child" score into its parent with
 * max, so a threshold keyed by "harassment" also catches "harassment/threatening".
 */
export function foldScores(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    out[key] = Math.max(out[key] ?? 0, n);
    const slash = key.indexOf("/");
    if (slash > 0) {
      const parent = key.slice(0, slash);
      out[parent] = Math.max(out[parent] ?? 0, n);
    }
  }
  return out;
}

/** Parse an OpenAI moderation response. Multiple results (one per input) are merged with max. */
export function parseOpenAiResponse(body: unknown): ModerationResult {
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results) || !results.length) throw new Error("moderation response has no results");
  const scores: Record<string, number> = {};
  let flagged = false;
  for (const r of results as { flagged?: unknown; category_scores?: Record<string, unknown> }[]) {
    if (!r || typeof r.category_scores !== "object" || r.category_scores === null) throw new Error("moderation result has no category_scores");
    flagged ||= r.flagged === true;
    for (const [k, v] of Object.entries(foldScores(r.category_scores))) scores[k] = Math.max(scores[k] ?? 0, v);
  }
  return { scores, flagged };
}

export function buildOpenAiPayload(model: string, input: ModerationInput) {
  const items: ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] = [];
  if (input.text?.trim()) items.push({ type: "text", text: input.text });
  for (const url of input.imageUrls ?? []) items.push({ type: "image_url", image_url: { url } });
  return { model, input: items };
}

const TIMEOUT_MS = 10_000;
const RETRIES = 2;

class RetryableError extends Error {}

function openAiCompatible(name: string, endpoint: () => { baseUrl: string; apiKey?: string; model: string }): ModerationProvider {
  return {
    name,
    async moderate(input) {
      const { baseUrl, apiKey, model } = endpoint();
      const payload = buildOpenAiPayload(model, input);
      if (!payload.input.length) return { scores: {}, flagged: false };
      let lastError: unknown;
      for (let attempt = 0; attempt <= RETRIES; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));
        try {
          const res = await fetch(`${baseUrl.replace(/\/$/, "")}/moderations`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          if (res.status === 429 || res.status >= 500) throw new RetryableError(`moderation provider answered ${res.status}`);
          if (!res.ok) throw new Error(`moderation provider answered ${res.status}`);
          return parseOpenAiResponse(await res.json());
        } catch (err) {
          lastError = err;
          // Network failures, timeouts, 429 and 5xx are worth another try; a 4xx or a bad body is not.
          const retryable = err instanceof RetryableError || (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError" || err.name === "TypeError"));
          if (!retryable) throw err;
        }
      }
      throw lastError instanceof Error ? lastError : new Error("moderation provider failed");
    },
  };
}

export const openAiProvider = openAiCompatible("openai", () => ({ baseUrl: config.OPENAI_BASE_URL, apiKey: config.OPENAI_API_KEY, model: config.OPENAI_MODERATION_MODEL }));
export const stubProvider = openAiCompatible("stub", () => ({ baseUrl: `${config.MODERATION_STUB_URL.replace(/\/$/, "")}/v1`, model: config.OPENAI_MODERATION_MODEL }));

// ─── Rules ──────────────────────────────────────────────────────────────────

const LINK = /\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/gi;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `term` appears in `text` as a whole word (or phrase), ignoring case. */
export function containsTerm(text: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  // \b only works next to word characters; use lookarounds so terms with symbols still match.
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(t)}(?![\\p{L}\\p{N}_])`, "iu").test(text);
}

export function rulesScores(input: ModerationInput): Record<string, number> {
  const text = input.text ?? "";
  const scores: Record<string, number> = {};
  if ((input.blockedTerms ?? []).some((term) => containsTerm(text, term))) scores.harassment = 0.9;
  const links = text.match(LINK)?.length ?? 0;
  if (links > 5 || (input.recentDuplicates ?? 0) >= 3) scores.spam = 0.95;
  return scores;
}

export const rulesProvider: ModerationProvider = {
  name: "rules",
  async moderate(input) {
    const scores = rulesScores(input);
    return { scores, flagged: Object.keys(scores).length > 0 };
  },
};

// ─── Selection ──────────────────────────────────────────────────────────────

let override: ModerationProvider | null = null;

/** Tests: force a provider regardless of settings (null restores normal selection). */
export function setModerationProviderForTests(p: ModerationProvider | null): void {
  override = p;
}

export function providerFor(name: ProviderName): ModerationProvider {
  if (override) return override;
  if (name === "openai") return openAiProvider;
  if (name === "stub") return stubProvider;
  return rulesProvider;
}
