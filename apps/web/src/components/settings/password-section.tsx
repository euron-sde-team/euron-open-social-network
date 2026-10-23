"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { isApiError } from "@open-social/api-client";
import { Button, Field, toast } from "@open-social/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { PasswordInput, StrengthMeter } from "@/components/auth/password-input";
import { SettingsCard } from "./section";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(10, "Use at least 10 characters").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ["confirm"], message: "The passwords do not match" })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ["newPassword"], message: "Choose a password you have not used here" });
type Values = z.infer<typeof schema>;

export function PasswordSection() {
  const { logout } = useAuth();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { currentPassword: "", newPassword: "", confirm: "" } });
  const errs = form.formState.errors;
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(async (v) => {
        try {
          await api().auth.changePassword(v.currentPassword, v.newPassword);
          // The API ends every session (including this one) when the password changes.
          toast.success({ title: "Password changed, sign in again", description: "For your security, all sessions were signed out." });
          await logout({ silent: false });
        } catch (e) {
          if (isApiError(e) && e.code === "INVALID_CREDENTIALS") form.setError("currentPassword", { message: "That is not your current password." });
          else if (isApiError(e) && e.code === "WEAK_PASSWORD") form.setError("newPassword", { message: errorMessage(e) });
          else toast.error({ title: errorMessage(e) });
        }
      })}
    >
      <SettingsCard
        title="Change password"
        description="You will be signed out everywhere and asked to sign in again."
        footer={
          <Button type="submit" loading={form.formState.isSubmitting} data-testid="settings-save">
            Change password
          </Button>
        }
      >
        <div className="max-w-sm space-y-4">
          <Field label="Current password" htmlFor="currentPassword" error={errs.currentPassword?.message}>
            <PasswordInput id="currentPassword" autoComplete="current-password" {...form.register("currentPassword")} />
          </Field>
          <Field label="New password" htmlFor="newPassword" error={errs.newPassword?.message}>
            <PasswordInput id="newPassword" autoComplete="new-password" {...form.register("newPassword")} />
            {!errs.newPassword ? <StrengthMeter value={form.watch("newPassword")} /> : null}
          </Field>
          <Field label="Confirm new password" htmlFor="confirm" error={errs.confirm?.message}>
            <PasswordInput id="confirm" autoComplete="new-password" {...form.register("confirm")} />
          </Field>
        </div>
      </SettingsCard>
    </form>
  );
}
