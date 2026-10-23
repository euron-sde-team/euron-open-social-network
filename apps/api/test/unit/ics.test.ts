import { describe, expect, test } from "vitest";
import { buildIcs, escapeText, foldLine, icsDate } from "../../src/domain/ics";

const event = {
  uid: "01HZX0000000000000000000AA@example.com",
  title: "Planning; Q3, kickoff",
  description: "Line one\nLine two",
  location: "Room 4, Floor 2",
  url: "https://meet.example.com/abc",
  startsAt: new Date("2026-07-01T15:00:00Z"),
  endsAt: new Date("2026-07-01T16:30:00Z"),
  createdAt: new Date("2026-06-01T00:00:00Z"),
  updatedAt: new Date("2026-06-02T00:00:00Z"),
  cancelled: false,
  organizerName: "Rowan Vale",
};

describe("ics", () => {
  test("escapes TEXT values", () => {
    expect(escapeText("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
  });

  test("dates are UTC basic format", () => {
    expect(icsDate(new Date("2026-07-01T15:00:00.123Z"))).toBe("20260701T150000Z");
  });

  test("builds a CRLF calendar with one event", () => {
    const out = buildIcs(event, "Test Network");
    expect(out.endsWith("\r\n")).toBe(true);
    expect(out.split("\r\n").filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    expect(out).toContain("SUMMARY:Planning\\; Q3\\, kickoff");
    expect(out).toContain("DTSTART:20260701T150000Z");
    expect(out).toContain("DTEND:20260701T163000Z");
    expect(out).toContain("LOCATION:Room 4\\, Floor 2");
    expect(out).toContain("URL:https://meet.example.com/abc");
    expect(out).toContain("STATUS:CONFIRMED");
    expect(out).not.toMatch(/[^\r]\n/);
  });

  test("omits the link when the viewer may not see it, and marks cancellations", () => {
    const out = buildIcs({ ...event, url: null, cancelled: true }, "Test Network");
    expect(out).not.toContain("meet.example.com");
    expect(out).toContain("STATUS:CANCELLED");
  });

  test("folds long lines at 75 octets without splitting characters", () => {
    const line = `DESCRIPTION:${"é".repeat(100)}`;
    const folded = foldLine(line);
    for (const part of folded.split("\r\n")) expect(Buffer.byteLength(part, "utf8")).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n").map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(line);
  });
});
