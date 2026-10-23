/**
 * Platform settings: one JSON document per key in the `settings` table, merged over the
 * defaults below, cached for a few seconds per process. Admins edit them through
 * /api/admin/settings.
 */
import type { PlatformSettings } from "@open-social/types";
import { config } from "../core/config";
import { db, type Executor } from "../db/kysely";

export const DEFAULT_SETTINGS: PlatformSettings = {
  networkName: config.PRODUCT_NAME,
  communityCreation: "EVERYONE",
  maxCommunitiesPerUser: 10,
  networkWideEvents: "STAFF",
  registration: "OPEN",
  moderation: {
    enabled: true,
    provider: config.MODERATION_PROVIDER,
    // Scores are 0..1. At or above `review` the item enters the queue and stays visible;
    // at or above `hide` it is hidden at once and the author can appeal.
    thresholds: {
      harassment: { review: 0.5, hide: 0.85 },
      hate: { review: 0.4, hide: 0.8 },
      violence: { review: 0.5, hide: 0.85 },
      sexual: { review: 0.5, hide: 0.85 },
      "sexual/minors": { review: 0.1, hide: 0.3 },
      "self-harm": { review: 0.3, hide: 0.9 },
      illicit: { review: 0.6, hide: 0.9 },
      spam: { review: 0.6, hide: 0.9 },
    },
    premoderateNewAccounts: { enabled: false, firstPosts: 3, accountAgeDays: 2 },
    blockedTerms: [],
  },
};

const TTL_MS = 5_000;
let cache: { at: number; value: PlatformSettings } | null = null;

function merge(base: PlatformSettings, stored: Partial<PlatformSettings>): PlatformSettings {
  return {
    ...base,
    ...stored,
    moderation: {
      ...base.moderation,
      ...(stored.moderation ?? {}),
      thresholds: { ...base.moderation.thresholds, ...(stored.moderation?.thresholds ?? {}) },
      premoderateNewAccounts: { ...base.moderation.premoderateNewAccounts, ...(stored.moderation?.premoderateNewAccounts ?? {}) },
    },
  };
}

export async function getSettings(exec: Executor = db): Promise<PlatformSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const row = await exec.selectFrom("settings").select("value").where("key", "=", "platform").executeTakeFirst();
  const value = merge(DEFAULT_SETTINGS, (row?.value as Partial<PlatformSettings>) ?? {});
  cache = { at: Date.now(), value };
  return value;
}

export async function saveSettings(patch: Partial<PlatformSettings>, actorId: string, exec: Executor = db): Promise<PlatformSettings> {
  const current = await getSettings(exec);
  const next = merge(current, patch);
  await exec
    .insertInto("settings")
    .values({ key: "platform", value: JSON.stringify(next), updated_by: actorId })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value: JSON.stringify(next), updated_by: actorId, updated_at: new Date() }))
    .execute();
  cache = null;
  return next;
}

export function clearSettingsCache(): void {
  cache = null;
}

/** The name to show for this network (emails, page titles): settings.networkName, else PRODUCT_NAME. */
export async function networkName(exec: Executor = db): Promise<string> {
  return (await getSettings(exec)).networkName?.trim() || config.PRODUCT_NAME;
}
