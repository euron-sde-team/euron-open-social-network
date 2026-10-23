import { describe, expect, it, vi } from "vitest";
import { createSocket } from "../src";

function fakeIo() {
  const socket = { connected: false, active: false, connect: vi.fn(), disconnect: vi.fn() };
  socket.connect.mockImplementation(() => {
    socket.connected = true;
  });
  socket.disconnect.mockImplementation(() => {
    socket.connected = false;
  });
  let opts: { auth: (cb: (d: object) => void) => void } | undefined;
  const factory = vi.fn((o: typeof opts) => {
    opts = o;
    return socket;
  });
  return { socket, factory, authPayload: () => new Promise((r) => opts!.auth(r)) };
}

describe("createSocket", () => {
  it("authenticates every handshake with the current token", async () => {
    let token = "a";
    const f = fakeIo();
    const ctl = createSocket(() => token, { ioFactory: f.factory as never });
    ctl.connect();
    expect(f.socket.connect).toHaveBeenCalledOnce();
    await expect(f.authPayload()).resolves.toEqual({ token: "a" });
    token = "b";
    await expect(f.authPayload()).resolves.toEqual({ token: "b" });
  });

  it("reconnects when the token changes, not when it is the same", () => {
    let token = "a";
    const f = fakeIo();
    const ctl = createSocket(() => token, { ioFactory: f.factory as never });
    ctl.connect();
    ctl.reconnectWithFreshToken();
    expect(f.socket.disconnect).not.toHaveBeenCalled();
    token = "b";
    ctl.reconnectWithFreshToken();
    expect(f.socket.disconnect).toHaveBeenCalledOnce();
    expect(f.socket.connect).toHaveBeenCalledTimes(2);
  });

  it("does not connect without a token and disconnects on sign-out", () => {
    let token: string | null = null;
    const f = fakeIo();
    const ctl = createSocket(() => token, { ioFactory: f.factory as never });
    ctl.connect();
    expect(f.socket.connect).not.toHaveBeenCalled();
    token = "x";
    ctl.connect();
    token = null;
    ctl.reconnectWithFreshToken();
    expect(f.socket.connected).toBe(false);
  });
});
