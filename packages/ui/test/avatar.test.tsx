import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "../src/components/avatar";
import { AVATAR_HUES, avatarColor, avatarHue, hashString, initials } from "../src/lib/avatar";

describe("initials", () => {
  it("takes the first letters of the first and last words", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("ada  byron  lovelace")).toBe("AL");
  });
  it("handles single words, separators and empty names", () => {
    expect(initials("grace")).toBe("G");
    expect(initials("grace_hopper")).toBe("GH");
    expect(initials("  ")).toBe("?");
    expect(initials(null)).toBe("?");
  });
  it("does not split surrogate pairs", () => {
    expect(initials("\u{1F600}smile")).toBe("\u{1F600}");
  });
});

describe("avatar colour", () => {
  it("is deterministic for the same seed", () => {
    expect(avatarColor("01HXYZ")).toBe(avatarColor("01HXYZ"));
    expect(hashString("abc")).toBe(hashString("abc"));
  });
  it("always picks from the palette", () => {
    for (const seed of ["a", "b", "user_1", "01J0000000000000000000000", ""]) {
      expect(AVATAR_HUES).toContain(avatarHue(seed));
    }
  });
  it("spreads different seeds across several hues", () => {
    const hues = new Set(Array.from({ length: 60 }, (_, i) => avatarHue(`user-${i}`)));
    expect(hues.size).toBeGreaterThan(5);
  });
});

describe("<Avatar>", () => {
  it("renders initials with the seeded colour when there is no image", () => {
    render(<Avatar name="Ada Lovelace" seed="u1" />);
    const fb = screen.getByTestId("avatar-fallback");
    expect(fb).toHaveTextContent("AL");
    expect(fb.style.backgroundColor).not.toBe("");
    expect(screen.getByText("Ada Lovelace")).toHaveClass("sr-only");
  });
  it("shows an online dot only when online", () => {
    const { rerender } = render(<Avatar name="A B" online />);
    expect(screen.getByLabelText("Online")).toBeInTheDocument();
    rerender(<Avatar name="A B" online={false} />);
    expect(screen.getByLabelText("Offline")).toHaveClass("hidden");
  });
});
