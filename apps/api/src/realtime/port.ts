/**
 * The realtime output port. Services never touch Socket.IO directly: they queue emits on
 * an `Effects` buffer, which calls this port after the transaction commits.
 *
 * The transport is installed at boot:
 *   - API process: the Socket.IO server (gateway.ts)
 *   - worker:      @socket.io/redis-emitter, so jobs reach sockets on every API task
 *   - tests:       a recorder (see test/integration/harness.ts) or nothing
 */
import type { ServerToClientEvents } from "@open-social/types";

export type EventName = keyof ServerToClientEvents;
export type EventPayload<E extends EventName> = Parameters<ServerToClientEvents[E]>[0];

export interface RealtimeTransport {
  emit<E extends EventName>(rooms: string[], event: E, payload: EventPayload<E>): void;
  /** Force every socket of these users to disconnect (suspension, ban, sign-out everywhere). */
  disconnectUsers(userIds: string[], reason: "SUSPENDED" | "BANNED" | "SIGNED_OUT"): void;
  /**
   * Take every socket of these users out of these rooms, on every API task: access
   * revoked (left or removed from a community or group, banned, blocked). The next
   * subscribe re-checks the rule, so they cannot simply join again.
   */
  leaveRooms(userIds: string[], rooms: string[]): void;
}

const noop: RealtimeTransport = { emit() {}, disconnectUsers() {}, leaveRooms() {} };
let transport: RealtimeTransport = noop;

export function setRealtimeTransport(t: RealtimeTransport | null): void {
  transport = t ?? noop;
}

export const realtime: RealtimeTransport = {
  emit(rooms, event, payload) {
    if (rooms.length) transport.emit(rooms, event, payload);
  },
  disconnectUsers(userIds, reason) {
    if (userIds.length) transport.disconnectUsers(userIds, reason);
  },
  leaveRooms(userIds, leave) {
    if (userIds.length && leave.length) transport.leaveRooms(userIds, leave);
  },
};

export const rooms = {
  user: (id: string) => `user:${id}`,
  thread: (id: string) => `thread:${id}`,
  chat: (communityId: string) => `chat:${communityId}`,
  community: (id: string) => `community:${id}`,
  post: (id: string) => `post:${id}`,
  staff: "staff",
};
