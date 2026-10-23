/**
 * Notification rows to DTOs. A snippet quotes content, so it is withheld when it came
 * from a private community the recipient can no longer read (they left or were
 * removed after the notification was created).
 */
import type { Notification } from "@open-social/types";
import type { Actor } from "../core/context";
import { db, type Executor } from "../db/kysely";
import type { Selectable } from "kysely";
import type { Notifications } from "../db/types";
import { communityRepo } from "../repositories/community.repository";
import { hrefFor } from "../services/notification.service";
import { accessMap } from "./community.presenter";
import { loadSummaries } from "./user.presenter";

export type NotificationRow = Selectable<Notifications>;

export async function presentNotifications(viewer: Actor, rows: readonly NotificationRow[], exec: Executor = db): Promise<Notification[]> {
  if (!rows.length) return [];
  const communityIds = rows.map((r) => r.community_id).filter((x): x is string => !!x);
  const [actors, communities] = await Promise.all([loadSummaries(rows.map((r) => r.actor_id), exec), communityRepo.findMany(communityIds, exec)]);
  const access = await accessMap(viewer, communities, exec);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    actor: r.actor_id ? (actors.get(r.actor_id) ?? null) : null,
    entityType: r.entity_type,
    entityId: r.entity_id,
    communityId: r.community_id,
    snippet: r.community_id && !access.get(r.community_id)?.canRead ? null : r.snippet,
    href: hrefFor(r),
    readAt: r.read_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
  }));
}
