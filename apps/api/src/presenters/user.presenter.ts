import type { Me, UserSummary } from "@open-social/types";
import { type Executor, db } from "../db/kysely";
import { userRepo, type UserRow } from "../repositories/user.repository";
import { loadMedia, urlOf } from "./media.presenter";

export interface SummaryRow {
  id: string;
  username: string;
  display_name: string;
  headline: string | null;
  role: UserSummary["role"];
  avatar_upload_id: string | null;
}

export function toSummary(row: SummaryRow, avatarUrl: string | null): UserSummary {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl,
    headline: row.headline,
    role: row.role,
  };
}

/** Batch-load UserSummary DTOs for a set of user ids. */
export async function loadSummaries(ids: readonly (string | null | undefined)[], exec: Executor = db): Promise<Map<string, UserSummary>> {
  const wanted = ids.filter((x): x is string => !!x);
  const rows = await userRepo.findSummaries(wanted, exec);
  const media = await loadMedia(rows.map((r) => r.avatar_upload_id), exec);
  return new Map(rows.map((r) => [r.id, toSummary(r, urlOf(media, r.avatar_upload_id, "thumb"))]));
}

export async function summaryOf(id: string, exec: Executor = db): Promise<UserSummary | null> {
  return (await loadSummaries([id], exec)).get(id) ?? null;
}

export async function toMe(row: UserRow, exec: Executor = db): Promise<Me> {
  const media = await loadMedia([row.avatar_upload_id], exec);
  return {
    ...toSummary(row, urlOf(media, row.avatar_upload_id, "thumb")),
    email: row.email,
    status: row.status,
    suspendedUntil: row.status === "SUSPENDED" && row.suspended_until ? row.suspended_until.toISOString() : null,
    emailVerified: !!row.email_verified_at,
    totpEnabled: row.totp_enabled,
    dmPrivacy: row.dm_privacy,
    emailDigest: row.email_digest,
    reputation: row.reputation,
    level: row.level,
  };
}
