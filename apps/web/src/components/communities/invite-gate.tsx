"use client";

import Link from "next/link";
import { MailOpen } from "lucide-react";
import { Button, Card } from "@open-social/ui";
import { useAuth } from "@/lib/auth";
import { useProductName } from "@/lib/meta";
import { FullPageSpinner } from "@/components/common/require-auth";
import { InviteLanding } from "./invite-landing";

/** Where a signed-out invitee goes: sign up with the code pre-filled, then back to this invite. */
export function inviteLinks(code: string): { signup: string; login: string } {
  const back = encodeURIComponent(`/invite/${encodeURIComponent(code)}`);
  return { signup: `/signup?invite=${encodeURIComponent(code)}&next=${back}`, login: `/login?next=${back}` };
}

/** Signed in: the invite card. Signed out: an invitation to create an account with the code. */
export function InviteGate({ code }: { code: string }) {
  const { status } = useAuth();
  const name = useProductName();
  if (status === "loading") return <FullPageSpinner />;
  if (status === "signed-in") return <InviteLanding code={code} />;
  const links = inviteLinks(code);
  return (
    <Card className="px-6 py-8 text-center" data-testid="invite-signed-out">
      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
        <MailOpen className="size-6" />
      </div>
      <h1 className="text-2xl font-bold">You have been invited</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">Create an account on {name} to accept, or sign in if you already have one.</p>
      <div className="mx-auto mt-5 flex max-w-xs flex-col gap-2">
        <Button asChild size="lg" block>
          <Link href={links.signup} data-testid="invite-signup">
            Create an account
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline" block>
          <Link href={links.login}>Sign in</Link>
        </Button>
      </div>
    </Card>
  );
}
