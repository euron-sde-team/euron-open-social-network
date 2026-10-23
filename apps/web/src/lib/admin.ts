/** Pure helpers for the admin area. */

export interface Threshold {
  review: number;
  hide: number;
}

/** Errors per category: values must be within 0..1 and review must not exceed hide. */
export function thresholdErrors(t: Record<string, Threshold>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    if (!(v.review >= 0 && v.review <= 1) || !(v.hide >= 0 && v.hide <= 1)) out[k] = "Values must be between 0 and 1.";
    else if (v.review > v.hide) out[k] = "The review threshold must be at or below the hide threshold.";
  }
  return out;
}

/** SVG path for a sparkline through `values` in a `w` by `h` box (with padding). */
export function sparklinePath(values: number[], w: number, h: number, pad = 2): { line: string; area: string; max: number } {
  if (!values.length) return { line: "", area: "", max: 0 };
  const max = Math.max(...values, 0);
  const innerH = h - pad * 2;
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const pts = values.map((v, i) => {
    const x = pad + i * step;
    const y = max > 0 ? pad + innerH - (v / max) * innerH : pad + innerH;
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100] as const;
  });
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  const last = pts[pts.length - 1]!;
  const first = pts[0]!;
  const area = `${line} L${last[0]} ${h - pad} L${first[0]} ${h - pad} Z`;
  return { line, area, max };
}

/** "Chrome on macOS" from a user agent string. */
export function summarizeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS/.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : /curl|node|okhttp|axios/i.test(ua)
              ? "App or script"
              : "Browser";
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X|Macintosh/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  return os ? `${browser} on ${os}` : browser;
}

/** Whole days since an ISO date. */
export function daysSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
}
