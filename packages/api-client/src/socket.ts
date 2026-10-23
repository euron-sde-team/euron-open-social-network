import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@open-social/types";

export type SocialSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface SocketOptions {
  /** Origin to connect to; empty for same origin (the web app proxies /socket.io). */
  url?: string;
  path?: string;
  /** Injected for tests. */
  ioFactory?: typeof io;
}

/**
 * A typed Socket.IO client authenticated with the in-memory access token.
 * `auth` is a function, so every (re)connect reads the latest token, and
 * `reconnectWithFreshToken()` forces a reconnect after a refresh (the server
 * authenticates once, at handshake).
 */
export function createSocket(getToken: () => string | null, opts: SocketOptions = {}) {
  const factory = opts.ioFactory ?? io;
  const options = {
    path: opts.path ?? "/socket.io",
    autoConnect: false,
    withCredentials: true,
    transports: ["websocket", "polling"],
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    auth: (cb: (data: object) => void) => cb({ token: getToken() ?? "" }),
  };
  // No url: socket.io connects to the page's own origin (an empty string would not).
  const socket: SocialSocket = opts.url ? factory(opts.url, options) : factory(options);

  let lastToken: string | null = null;

  return {
    socket,
    connect() {
      lastToken = getToken();
      if (lastToken && !socket.connected) socket.connect();
    },
    /** Call after a token refresh. No-op when the token did not change. */
    reconnectWithFreshToken() {
      const token = getToken();
      if (!token) {
        socket.disconnect();
        lastToken = null;
        return;
      }
      if (token === lastToken && socket.connected) return;
      lastToken = token;
      if (socket.connected || socket.active) socket.disconnect();
      socket.connect();
    },
    disconnect() {
      lastToken = null;
      socket.disconnect();
    },
  };
}

export type SocketController = ReturnType<typeof createSocket>;
