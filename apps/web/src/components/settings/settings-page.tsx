"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Ban, KeyRound, Lock, Mail, MonitorSmartphone, ShieldCheck, UserCog, UserRound } from "lucide-react";
import { cn } from "@open-social/ui";
import { PageTitle } from "@/components/common/states";
import { ProfileSection } from "./profile-section";
import { PrivacySection } from "./privacy-section";
import { PasswordSection } from "./password-section";
import { TwoFactorSection } from "./two-factor-section";
import { SessionsSection } from "./sessions-section";
import { BlockedSection } from "./blocked-section";
import { EmailSection } from "./email-section";
import { AccountSection } from "./account-section";

const SECTIONS = [
  { id: "profile", label: "Profile", icon: UserRound, render: () => <ProfileSection /> },
  { id: "privacy", label: "Privacy", icon: Lock, render: () => <PrivacySection /> },
  { id: "email", label: "Email", icon: Mail, render: () => <EmailSection /> },
  { id: "password", label: "Password", icon: KeyRound, render: () => <PasswordSection /> },
  { id: "two-factor", label: "Two-factor", icon: ShieldCheck, render: () => <TwoFactorSection /> },
  { id: "sessions", label: "Sessions", icon: MonitorSmartphone, render: () => <SessionsSection /> },
  { id: "blocked", label: "Blocked people", icon: Ban, render: () => <BlockedSection /> },
  { id: "account", label: "Account", icon: UserCog, render: () => <AccountSection /> },
] as const;

export function SettingsPage() {
  const requested = useSearchParams().get("section");
  const current = SECTIONS.find((s) => s.id === requested) ?? SECTIONS[0];
  return (
    <div>
      <PageTitle title="Settings" description="Manage your profile, privacy and account security." />
      <div className="flex flex-col gap-6 md:flex-row">
        <nav aria-label="Settings sections" className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:w-56 md:shrink-0 md:flex-col md:px-0">
          {SECTIONS.map((s) => {
            const active = s.id === current.id;
            return (
              <Link
                key={s.id}
                href={`/settings?section=${s.id}`}
                scroll={false}
                aria-current={active ? "page" : undefined}
                data-testid={`settings-nav-${s.id}`}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors",
                  active ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <s.icon className="size-4" /> {s.label}
              </Link>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1">{current.render()}</div>
      </div>
    </div>
  );
}
