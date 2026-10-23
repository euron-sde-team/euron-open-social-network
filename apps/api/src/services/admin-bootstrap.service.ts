/**
 * `admin:create`: make someone a platform admin from the command line (the first admin
 * of a new install, or a recovery when nobody can sign in as admin).
 *
 *   existing account  promoted to ADMIN, activated and marked verified. The password is
 *                     NEVER touched: whoever runs the tool must not be able to take over
 *                     an account by naming its email.
 *   new account       created with a random password nobody sees, and a "set your
 *                     password" link (the normal reset flow) is emailed. When the mail
 *                     cannot go out (MAIL_MODE=outbox, or the transport fails) nothing is
 *                     kept and the command fails, telling the operator to run it locally
 *                     with --print-password.
 *
 * Why no password on stdout by default: on ECS, stdout goes to CloudWatch Logs, where a
 * printed password would be readable by anyone with log access for the retention period.
 * --print-password prints a one-time password for a new account (local use only).
 */
import crypto from "node:crypto";
import { config } from "../core/config";
import { newId } from "../core/ids";
import { db } from "../db/kysely";
import { userRepo } from "../repositories/user.repository";
import { hashPassword } from "../security/passwords";
import { audit } from "./audit.service";
import { forgotPassword } from "./auth.service";

export interface CreateAdminInput {
  email: string;
  username?: string;
  name?: string;
  printPassword?: boolean;
}

export type CreateAdminResult =
  | { kind: "PROMOTED"; email: string; message: string }
  | { kind: "CREATED_LINK_SENT"; email: string; message: string }
  | { kind: "CREATED_WITH_PASSWORD"; email: string; password: string; message: string };

export class AdminBootstrapError extends Error {}

const RERUN_HINT = "Nothing was created. Fix the mail settings (MAIL_MODE, MAIL_FROM and the SMTP or SES settings) and run it again, or run it on a trusted machine with --print-password (never where stdout is logged).";

export async function createAdmin(input: CreateAdminInput): Promise<CreateAdminResult> {
  const email = input.email.trim().toLowerCase();
  const username = input.username ?? email.split("@")[0]?.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 30);
  if (!email.includes("@") || !username || username.length < 3) throw new AdminBootstrapError('usage: admin:create --email you@example.com [--username you] [--name "Your Name"] [--print-password]');

  const existing = await userRepo.findByEmail(email);
  if (existing) {
    await userRepo.update(existing.id, { role: "ADMIN", status: "ACTIVE", suspended_until: null, email_verified_at: existing.email_verified_at ?? new Date() });
    await audit({ actorId: null, action: "admin.bootstrap.promote", entityType: "user", entityId: existing.id, data: { from: { role: existing.role, status: existing.status } } });
    return { kind: "PROMOTED", email, message: `Existing account ${email} is now an admin. Its password was not changed; use "Forgot password" if it is unknown.` };
  }

  if (!input.printPassword && config.MAIL_MODE === "outbox") {
    throw new AdminBootstrapError(`Cannot email a set-password link: MAIL_MODE=outbox writes mail to disk instead of sending it. ${RERUN_HINT}`);
  }

  const password = crypto.randomBytes(12).toString("base64url");
  const row = await userRepo.insert({
    id: newId(),
    email,
    username,
    display_name: input.name ?? username,
    password_hash: await hashPassword(password),
    role: "ADMIN",
    status: "ACTIVE",
    email_verified_at: new Date(),
  });
  await audit({ actorId: null, action: "admin.bootstrap.create", entityType: "user", entityId: row.id });

  if (input.printPassword) {
    return { kind: "CREATED_WITH_PASSWORD", email, password, message: `Admin ready: ${email}\nOne-time password (change it after signing in): ${password}` };
  }

  // The random password above is never shown; the admin chooses their own via the link.
  const sent = await forgotPassword(email);
  if (!sent?.delivered) {
    // Undo: an admin account nobody can sign in to is worse than none.
    await db.deleteFrom("users").where("id", "=", row.id).execute();
    throw new AdminBootstrapError(`The set-password email could not be sent (${sent?.error ?? `mail mode ${sent?.mode ?? config.MAIL_MODE} did not deliver it`}). ${RERUN_HINT}`);
  }
  return { kind: "CREATED_LINK_SENT", email, message: `Admin ready: ${email}\nA link to set the password was emailed to that address (valid for 1 hour).` };
}
