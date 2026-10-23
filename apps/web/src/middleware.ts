import { NextResponse, type NextRequest } from "next/server";
import { mediaOrigins } from "@/lib/runtime-env";

/**
 * Per-request Content-Security-Policy with a nonce. Next reads the nonce from
 * the request's CSP header and stamps it on its own scripts; `strict-dynamic`
 * lets those load the app chunks. Media origins (S3, the local emulator, a CDN)
 * come from MEDIA_ORIGINS at runtime, so one image fits every environment.
 */
export function buildCsp(opts: { nonce: string; dev: boolean; media: string[]; wsOrigin: string | null }): string {
  const media = opts.media.join(" ");
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${opts.nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    // Radix positions popovers with inline styles; styles cannot run code.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${media}`.trim(),
    `media-src 'self' blob: ${media}`.trim(),
    "font-src 'self' data:",
    // Uploads PUT straight to the storage origin; the socket uses the same origin.
    `connect-src 'self' ${opts.wsOrigin ?? ""} ${media}${opts.dev ? " ws: wss:" : ""}`.replace(/\s+/g, " ").trim(),
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ];
  return directives.join("; ");
}

export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")).split(",")[0]?.trim();
  const wsOrigin = host ? `${proto === "https" ? "wss" : "ws"}://${host}` : null;
  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV !== "production",
    media: mediaOrigins(process.env.MEDIA_ORIGINS),
    wsOrigin,
  });

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|socket.io|_next/static|_next/image|env.js|icon.svg|favicon.ico).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
