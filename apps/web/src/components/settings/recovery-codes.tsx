"use client";

import { useState } from "react";
import { Copy, Download, KeyRound } from "lucide-react";
import { Button, Checkbox, toast } from "@open-social/ui";
import { saveBlob } from "@/lib/download";
import { SettingsCard } from "./section";

/** The plain-text file a user saves: one code per line under a short header. */
export function recoveryCodesText(codes: string[], productName: string): string {
  return [`${productName} recovery codes`, "Each code signs you in once if you lose your authenticator app.", "", ...codes, ""].join("\n");
}

/**
 * Shown exactly once, right after the API returns the codes: the user copies
 * or downloads them, ticks "I saved them" and only then can leave.
 */
export function RecoveryCodes({ codes, productName, onDone }: { codes: string[]; productName: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const text = recoveryCodesText(codes, productName);
  return (
    <SettingsCard
      title="Save your recovery codes"
      description="If you lose your authenticator app, each of these codes signs you in once. They will not be shown again."
      footer={
        <Button onClick={onDone} disabled={!saved} data-testid="recovery-done">
          Done
        </Button>
      }
    >
      <ul className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-4 font-mono text-sm sm:grid-cols-3" data-testid="recovery-codes">
        {codes.map((c) => (
          <li key={c} className="flex items-center gap-1.5">
            <KeyRound className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden />
            {c}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          data-testid="recovery-copy"
          onClick={() => navigator.clipboard?.writeText(codes.join("\n")).then(() => toast.success({ title: "Codes copied" }), () => undefined)}
        >
          <Copy /> Copy
        </Button>
        <Button variant="outline" size="sm" data-testid="recovery-download" onClick={() => saveBlob(new Blob([text], { type: "text/plain" }), "recovery-codes.txt")}>
          <Download /> Download
        </Button>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm font-medium">
        <Checkbox checked={saved} onCheckedChange={(v) => setSaved(v === true)} data-testid="recovery-saved" aria-label="I saved them" />
        <span>I saved them</span>
      </label>
    </SettingsCard>
  );
}
