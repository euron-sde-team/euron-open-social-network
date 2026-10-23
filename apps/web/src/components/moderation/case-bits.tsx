"use client";

import { Badge } from "@open-social/ui";
import type { CaseSource, ModerationCase } from "@open-social/types";
import { humanize } from "@/lib/moderation";

const SOURCE: Record<CaseSource, { label: string; tone: "primary" | "warning" | "neutral" }> = {
  AI: { label: "AI flag", tone: "primary" },
  REPORT: { label: "Reported", tone: "warning" },
  PREMODERATION: { label: "Pre-moderation", tone: "neutral" },
};

export function SourceBadge({ source }: { source: CaseSource }) {
  const s = SOURCE[source] ?? { label: source, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function StatusBadge({ status }: { status: ModerationCase["targetStatus"] }) {
  if (!status) return null;
  const tone = status === "PUBLISHED" || status === "ACTIVE" ? "success" : status === "PENDING_REVIEW" ? "warning" : status === "HIDDEN" || status === "SUSPENDED" ? "warning" : "danger";
  return <Badge tone={tone}>{humanize(status)}</Badge>;
}

export function Reasons({ reasons }: { reasons: ModerationCase["reasons"] }) {
  if (!reasons.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {reasons.map((r) => (
        <Badge key={r.reason} tone="outline">
          {humanize(r.reason)}
          {r.count > 1 ? ` x${r.count}` : ""}
        </Badge>
      ))}
    </span>
  );
}
