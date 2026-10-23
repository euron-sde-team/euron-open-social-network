import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import Script from "next/script";
import "./globals.css";
import { inter } from "./fonts";
import { Providers } from "@/lib/providers";
import { serverEnv } from "@/lib/runtime-env";
import { THEME_BOOT } from "@/lib/stores/theme";

// Per request: the product name and /env.js come from the container's environment,
// and the CSP nonce is per response.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const name = serverEnv().productName;
  return {
    title: { default: name, template: `%s | ${name}` },
    description: `${name}: communities, conversations and events.`,
    icons: { icon: "/icon.svg" },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0f141d" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <head>
        {/* Applies the saved theme before first paint (no flash). */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-dvh font-sans">
        {/* Runtime config (API URL, product name) before any client code reads it. */}
        <Script src="/env.js" strategy="beforeInteractive" nonce={nonce} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
