"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MailCheck } from "lucide-react";
import { isApiError } from "@open-social/api-client";
import { Button, Field, Input, toast } from "@open-social/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { useNetworkMeta } from "@/lib/meta";
import { safeNext } from "@/lib/navigation";
import { AuthHeading, FormAlert } from "./auth-shell";
import { PasswordInput, StrengthMeter } from "./password-input";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email address").max(254),
  username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_]{3,30}$/, "3 to 30 letters, digits or underscores"),
  displayName: z.string().trim().min(1, "Enter your name").max(80),
  password: z.string().min(10, "Use at least 10 characters").max(128),
  inviteCode: z.string().trim().max(64),
});
type Values = z.infer<typeof schema>;

const FIELD_FOR_CODE: Partial<Record<string, keyof Values>> = {
  EMAIL_TAKEN: "email",
  USERNAME_TAKEN: "username",
  WEAK_PASSWORD: "password",
  INVITE_REQUIRED: "inviteCode",
  INVITE_INVALID: "inviteCode",
};

/** Whether the form asks for an invite code: the network is invite-only. */
export function needsInviteCode(registration: string | undefined): boolean {
  return registration === "INVITE_ONLY";
}

export function SignupForm() {
  const { acceptSession, status } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const invite = params.get("invite")?.trim() ?? "";
  const meta = useNetworkMeta();
  const inviteOnly = needsInviteCode(meta.data?.registration);
  const closed = meta.data?.registration === "CLOSED";
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: "", username: "", displayName: "", password: "", inviteCode: invite } });
  const password = form.watch("password");

  useEffect(() => {
    if (status === "signed-in" && !sentTo) router.replace(next);
  }, [status, next, router, sentTo]);

  const onSubmit = async (v: Values) => {
    setError(null);
    if (inviteOnly && !v.inviteCode) {
      form.setError("inviteCode", { message: "Enter the invite code you were given" });
      return;
    }
    try {
      const r = await api().auth.signup({
        email: v.email.toLowerCase(),
        username: v.username,
        displayName: v.displayName,
        password: v.password,
        ...(inviteOnly && v.inviteCode ? { inviteCode: v.inviteCode } : {}),
      });
      if ("verificationRequired" in r) {
        setSentTo(r.email);
        return;
      }
      acceptSession(r);
      toast.success({ title: `Welcome, ${r.user.displayName.split(" ")[0]}` });
      router.replace(next);
    } catch (e) {
      if (isApiError(e)) {
        const field = FIELD_FOR_CODE[e.code];
        if (field) {
          form.setError(field, { message: errorMessage(e) });
          return;
        }
        if (e.code === "VALIDATION_FAILED") {
          let mapped = false;
          for (const [path, msg] of Object.entries(e.fieldErrors)) {
            if (path in v) {
              form.setError(path as keyof Values, { message: msg });
              mapped = true;
            }
          }
          if (mapped) return;
        }
      }
      setError(errorMessage(e));
    }
  };

  if (sentTo) {
    return (
      <div className="text-center" data-testid="signup-check-email">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
          <MailCheck className="size-6" />
        </div>
        <AuthHeading title="Check your email" description={<>We sent a confirmation link to <span className="font-semibold text-foreground">{sentTo}</span>. Open it to finish creating your account.</>} />
        <Button
          variant="outline"
          block
          loading={resending}
          onClick={async () => {
            setResending(true);
            try {
              await api().auth.resendVerification(sentTo);
              toast.success({ title: "Sent another link" });
            } catch (e) {
              toast.error({ title: errorMessage(e) });
            } finally {
              setResending(false);
            }
          }}
        >
          Resend email
        </Button>
        <p className="mt-4 text-sm text-muted-foreground">
          Wrong address?{" "}
          <button type="button" className="font-semibold text-link hover:underline" onClick={() => setSentTo(null)}>
            Start again
          </button>
        </p>
      </div>
    );
  }

  const errs = form.formState.errors;
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <AuthHeading title="Create your account" description="It takes less than a minute." />
      {error ? <FormAlert>{error}</FormAlert> : null}
      {closed ? <FormAlert tone="info">Sign-ups are closed on this network right now.</FormAlert> : null}
      <div className="space-y-4">
        {inviteOnly ? (
          <Field label="Invite code" htmlFor="inviteCode" hint="This network is invite only. Paste the code from your invite." error={errs.inviteCode?.message}>
            <Input id="inviteCode" autoComplete="off" spellCheck={false} data-testid="signup-invite-code" aria-invalid={!!errs.inviteCode || undefined} {...form.register("inviteCode")} />
          </Field>
        ) : null}
        <Field label="Email" htmlFor="email" error={errs.email?.message}>
          <Input id="email" type="email" autoComplete="email" autoFocus aria-invalid={!!errs.email || undefined} {...form.register("email")} />
        </Field>
        <Field label="Name" htmlFor="displayName" hint="How you appear to others" error={errs.displayName?.message}>
          <Input id="displayName" autoComplete="name" aria-invalid={!!errs.displayName || undefined} {...form.register("displayName")} />
        </Field>
        <Field label="Username" htmlFor="username" hint="3 to 30 letters, digits or underscores. People can @mention you with it." error={errs.username?.message}>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-subtle-foreground">@</span>
            <Input id="username" autoComplete="username" className="pl-7" aria-invalid={!!errs.username || undefined} {...form.register("username")} />
          </div>
        </Field>
        <Field label="Password" htmlFor="password" error={errs.password?.message}>
          <PasswordInput id="password" autoComplete="new-password" aria-invalid={!!errs.password || undefined} {...form.register("password")} />
          {!errs.password ? <StrengthMeter value={password} /> : null}
        </Field>
      </div>
      <Button type="submit" block size="lg" className="mt-6" loading={form.formState.isSubmitting} data-testid="signup-submit">
        Create account
      </Button>
      <p className="mt-5 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href={next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="font-semibold text-link hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
