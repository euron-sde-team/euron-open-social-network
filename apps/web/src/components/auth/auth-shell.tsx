"use client";

import Link from "next/link";
import { Wordmark } from "@/components/common/wordmark";
import { useProductName } from "@/lib/meta";

export function AuthShell({ children }: { children: React.ReactNode }) {
  const name = useProductName();
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <main id="main" className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Wordmark />
          <p className="text-sm text-muted-foreground">Communities, conversations and events on {name}.</p>
        </div>
        <div className="w-full max-w-[400px] rounded-xl border border-border bg-card p-6 shadow-card sm:p-8">{children}</div>
      </main>
      <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 pb-6 text-xs text-subtle-foreground">
        <Link href="/communities" className="hover:text-foreground hover:underline">
          Browse communities
        </Link>
        <Link href="/login" className="hover:text-foreground hover:underline">
          Sign in
        </Link>
        <Link href="/signup" className="hover:text-foreground hover:underline">
          Create account
        </Link>
        <span>Open-source and self-hostable</span>
      </footer>
    </div>
  );
}

export function AuthHeading({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function FormAlert({ tone = "danger", children }: { tone?: "danger" | "success" | "info"; children: React.ReactNode }) {
  const cls =
    tone === "danger"
      ? "border-danger/20 bg-danger-soft text-danger-soft-foreground"
      : tone === "success"
        ? "border-success/20 bg-success-soft text-success-soft-foreground"
        : "border-primary/20 bg-primary-soft text-primary-soft-foreground";
  return (
    <div role="alert" className={`mb-4 rounded-md border px-3 py-2.5 text-sm ${cls}`}>
      {children}
    </div>
  );
}
