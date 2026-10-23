import path from "node:path";
import type { NextConfig } from "next";

/**
 * Same-origin deployment: the browser only ever talks to this origin. In local
 * development the rewrites below proxy /api and /socket.io to the API; in
 * production the load balancer routes both paths to the API before they reach
 * Next, so the refresh cookie (scoped to /api/auth) stays first-party.
 */
const apiInternal = (process.env.API_INTERNAL_URL || "http://localhost:5006").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // One self-contained server bundle (`node apps/web/server.js`), the unit the image ships.
  output: "standalone",
  // In a monorepo the standalone trace must start at the repo root.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // The shared packages ship TypeScript source; Next compiles them in place.
  transpilePackages: ["@open-social/ui", "@open-social/api-client", "@open-social/types"],
  poweredByHeader: false,
  // Socket.IO asks for /socket.io/?EIO=...; the default trailing-slash redirect would
  // answer the WebSocket upgrade with a 308 it cannot follow. The API accepts the path
  // with or without the slash (the rewrite below drops it).
  skipTrailingSlashRedirect: true,
  reactStrictMode: true,
  // Media URLs are short-lived signed URLs from the API's storage (S3 or the
  // local emulator); optimising them would cache past their expiry.
  images: { unoptimized: true },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiInternal}/api/:path*` },
      { source: "/socket.io/:path*", destination: `${apiInternal}/socket.io/:path*` },
      { source: "/socket.io", destination: `${apiInternal}/socket.io/` },
    ];
  },
  // Static security headers. The Content-Security-Policy is set per request in
  // middleware.ts, because it carries a nonce and runtime media origins.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
