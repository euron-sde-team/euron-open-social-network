/** Only same-site paths are honoured as a post-login destination (no open redirects). */
export function safeNext(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;
  let v = raw.trim();
  try {
    v = decodeURIComponent(v);
  } catch {
    return fallback;
  }
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(v)) return fallback;
  // Do not bounce back into the auth pages.
  if (/^\/(login|signup|verify-email|forgot-password|reset-password)(\/|\?|$)/.test(v)) return fallback;
  return v;
}
