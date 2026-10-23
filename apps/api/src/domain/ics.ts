/**
 * iCalendar (RFC 5545) export for one event. Pure: the service decides what the viewer
 * may see (the virtual link only for people who are GOING, and organisers) and passes
 * only that in.
 */
export interface IcsEvent {
  uid: string;
  title: string;
  description: string;
  location: string | null;
  url: string | null;
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
  updatedAt: Date;
  cancelled: boolean;
  organizerName: string;
}

/** Escape a TEXT value: backslash, semicolon, comma and newlines. */
export function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** UTC basic format: 20260102T030405Z. */
export function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Fold a content line at 75 octets, continuation lines start with one space. */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const len = Buffer.byteLength(ch, "utf8");
    const limit = parts.length === 0 ? 75 : 74;
    if (size + len > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += len;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildIcs(e: IcsEvent, productName: string): string {
  const description = [e.description, e.url ? `Join: ${e.url}` : ""].filter(Boolean).join("\n\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${escapeText(productName)}//Events//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${icsDate(e.updatedAt)}`,
    `CREATED:${icsDate(e.createdAt)}`,
    `LAST-MODIFIED:${icsDate(e.updatedAt)}`,
    `DTSTART:${icsDate(e.startsAt)}`,
    `DTEND:${icsDate(e.endsAt)}`,
    `SUMMARY:${escapeText(e.title)}`,
    ...(description ? [`DESCRIPTION:${escapeText(description)}`] : []),
    ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
    ...(e.url ? [`URL:${e.url.replace(/[\r\n]/g, "")}`] : []),
    `ORGANIZER;CN=${escapeText(e.organizerName).replace(/[":]/g, "")}:noreply@invalid`,
    `STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
