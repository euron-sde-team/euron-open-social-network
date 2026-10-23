"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Copy, RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";
import { isApiError } from "@open-social/api-client";
import { Badge, Button, Field, Input, Skeleton, toast } from "@open-social/ui";
import { api } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { useProductName } from "@/lib/meta";
import { PasswordInput } from "@/components/auth/password-input";
import { RecoveryCodes } from "./recovery-codes";
import { SettingsCard } from "./section";

export function TwoFactorSection() {
  const me = useMe();
  const { reloadMe } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const name = useProductName();

  useEffect(() => {
    if (!setup) return;
    let alive = true;
    QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 200, errorCorrectionLevel: "M" })
      .then((d) => alive && setQr(d))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [setup]);

  const start = useMutation({ mutationFn: () => api().auth.totpSetup(), onSuccess: (s) => setSetup(s) });
  const enable = useMutation({
    mutationFn: () => api().auth.totpEnable(code),
    meta: { silent: true },
    onSuccess: async (r) => {
      setSetup(null);
      setQr(null);
      setCode("");
      setRecoveryCodes(r?.recoveryCodes?.length ? r.recoveryCodes : null);
      await reloadMe().catch(() => undefined);
      toast.success({ title: "Two-factor authentication is on" });
    },
    onError: (e) => setCodeError(isApiError(e) && e.code === "INVALID_TOTP" ? "That code did not match. Codes change every 30 seconds." : errorMessage(e)),
  });
  const confirmError = (e: unknown) =>
    toast.error({
      title: isApiError(e) && e.code === "INVALID_CREDENTIALS" ? "That password is not right." : isApiError(e) && e.code === "INVALID_TOTP" ? "That code did not match. Codes change every 30 seconds." : errorMessage(e),
    });
  const disable = useMutation({
    mutationFn: () => api().auth.totpDisable(password, confirmCode),
    meta: { silent: true },
    onSuccess: async () => {
      setPassword("");
      setConfirmCode("");
      await reloadMe().catch(() => undefined);
      toast.success({ title: "Two-factor authentication is off" });
    },
    onError: confirmError,
  });
  const regenerate = useMutation({
    mutationFn: () => api().auth.totpRecoveryCodes(password, confirmCode),
    meta: { silent: true },
    onSuccess: (r) => {
      setPassword("");
      setConfirmCode("");
      setRecoveryCodes(r.recoveryCodes);
    },
    onError: confirmError,
  });

  if (recoveryCodes) return <RecoveryCodes codes={recoveryCodes} productName={name} onDone={() => setRecoveryCodes(null)} />;

  if (me.totpEnabled) {
    const confirmed = !!password && confirmCode.length === 6;
    return (
      <SettingsCard
        title="Two-factor authentication"
        description="Your account asks for a code from your authenticator app when you sign in."
        footer={
          <>
            <Button variant="outline" onClick={() => regenerate.mutate()} disabled={!confirmed || disable.isPending} loading={regenerate.isPending} data-testid="totp-regenerate">
              <RefreshCw /> New recovery codes
            </Button>
            <Button variant="danger" onClick={() => disable.mutate()} disabled={!confirmed || regenerate.isPending} loading={disable.isPending} data-testid="totp-disable">
              <ShieldOff /> Turn off
            </Button>
          </>
        }
      >
        <Badge tone="success" size="md" className="mb-4">
          <ShieldCheck /> On
        </Badge>
        <p className="mb-4 text-sm text-muted-foreground">To turn it off or get new recovery codes (which replace the old ones), confirm your password and a current code.</p>
        <div className="max-w-sm space-y-4">
          <Field label="Password" htmlFor="totp-password">
            <PasswordInput id="totp-password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="6 digit code from your app" htmlFor="totp-confirm-code">
            <Input
              id="totp-confirm-code"
              data-testid="totp-confirm-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={confirmCode}
              onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="max-w-[160px] text-center tracking-[0.3em]"
            />
          </Field>
        </div>
      </SettingsCard>
    );
  }

  if (!setup) {
    return (
      <SettingsCard
        title="Two-factor authentication"
        description="Add a second step to sign-in with an authenticator app, so a stolen password is not enough."
        footer={
          <Button onClick={() => start.mutate()} loading={start.isPending} data-testid="totp-start">
            <ShieldCheck /> Set up
          </Button>
        }
      >
        <Badge tone="neutral" size="md">
          Off
        </Badge>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard
      title="Set up two-factor authentication"
      description="Scan the code with an authenticator app, then enter the 6 digit code it shows."
      footer={
        <>
          <Button variant="ghost" onClick={() => setSetup(null)}>
            Cancel
          </Button>
          <Button onClick={() => enable.mutate()} disabled={code.length !== 6} loading={enable.isPending} data-testid="totp-enable">
            Turn on
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="shrink-0 rounded-lg border border-border bg-white p-2">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR code for your authenticator app" width={180} height={180} data-testid="totp-qr" />
          ) : (
            <Skeleton className="size-[180px]" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <div>
            <p className="text-sm font-medium">Can not scan? Enter this key</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-sm">{setup.secret}</code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard?.writeText(setup.secret).then(() => toast.success({ title: "Key copied" }), () => undefined)}
              >
                <Copy /> Copy
              </Button>
            </div>
          </div>
          <Field label="6 digit code" htmlFor="totp-code" error={codeError}>
            <Input
              id="totp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => {
                setCodeError(null);
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              }}
              className="max-w-[160px] text-center tracking-[0.3em]"
            />
          </Field>
        </div>
      </div>
    </SettingsCard>
  );
}
