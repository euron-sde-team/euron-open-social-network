/**
 * Who is asking. Services take an `Actor` (or a nullable one for public reads) instead
 * of an Express request, so they are callable from routes, sockets, jobs and tests alike.
 */
import type { UserRole, UserStatus } from "@open-social/types";
import { forbidden, unauthenticated } from "./errors";

export interface Actor {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
}

export interface RequestMeta {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
}

export function isStaff(actor: Actor | null | undefined): boolean {
  return !!actor && (actor.role === "ADMIN" || actor.role === "MODERATOR");
}

export function isAdmin(actor: Actor | null | undefined): boolean {
  return !!actor && actor.role === "ADMIN";
}

export function requireActor(actor: Actor | null | undefined): Actor {
  if (!actor) throw unauthenticated();
  return actor;
}

/** Writes need an ACTIVE account: suspended users can read but not post, react or message. */
export function requireActive(actor: Actor | null | undefined): Actor {
  const a = requireActor(actor);
  if (a.status !== "ACTIVE") throw forbidden("Your account is restricted", "ACCOUNT_RESTRICTED");
  return a;
}

export function requireStaff(actor: Actor | null | undefined): Actor {
  const a = requireActor(actor);
  if (!isStaff(a)) throw forbidden();
  return a;
}

export function requireAdmin(actor: Actor | null | undefined): Actor {
  const a = requireActor(actor);
  if (!isAdmin(a)) throw forbidden();
  return a;
}
