/**
 * Realtime transport for processes without a Socket.IO server (the worker): publishes
 * through Redis to every API task's adapter.
 */
import { Emitter } from "@socket.io/redis-emitter";
import { newRedisClient } from "../integrations/redis";
import { rooms, setRealtimeTransport } from "./port";

export function startEmitter(): { close(): void } {
  const client = newRedisClient();
  const emitter = new Emitter(client);
  setRealtimeTransport({
    emit(targets, event, payload) {
      emitter.to(targets).emit(event, payload as never);
    },
    disconnectUsers(userIds, reason) {
      const targets = userIds.map(rooms.user);
      emitter.to(targets).emit("session:revoked", { reason });
      emitter.in(targets).disconnectSockets(true);
    },
    leaveRooms(userIds, leave) {
      emitter.in(userIds.map(rooms.user)).socketsLeave(leave);
    },
  });
  return { close: () => setRealtimeTransport(null) };
}
