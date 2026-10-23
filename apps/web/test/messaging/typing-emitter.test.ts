import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTypingEmitter } from "@/components/chat/composer";

describe("useTypingEmitter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("throttles typing=true and sends typing=false after a pause", () => {
    const onTyping = vi.fn();
    const { result, unmount } = renderHook(() => useTypingEmitter(onTyping));
    result.current.ping(0);
    result.current.ping(1000);
    result.current.ping(2000);
    expect(onTyping.mock.calls).toEqual([[true]]);
    result.current.ping(4000);
    expect(onTyping.mock.calls).toEqual([[true], [true]]);
    vi.advanceTimersByTime(4100);
    expect(onTyping).toHaveBeenLastCalledWith(false);
    result.current.ping(9000);
    unmount();
    expect(onTyping).toHaveBeenLastCalledWith(false);
  });
});
