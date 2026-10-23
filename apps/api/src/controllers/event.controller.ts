/** /api/events: list, create, read, edit, cancel, RSVP (with capacity and waitlist), attendees, .ics. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, idParam, optionalText, pageQuery, parse, text } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as events from "../services/event.service";

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((v) => /^https?:\/\//i.test(v), "must be an http(s) URL");

const timezone = z
  .string()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "unknown time zone");

const fields = {
  title: text(200, 3),
  description: optionalText(10000),
  location: optionalText(300),
  isVirtual: z.boolean().optional(),
  virtualLink: httpUrl.nullable().optional(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  timezone: timezone.optional(),
  capacity: z.number().int().min(1).max(100000).nullable().optional(),
  coverUploadId: id().nullable().optional(),
};

export async function list(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ scope: z.enum(["upcoming", "past", "going", "organising"]).default("upcoming"), communityId: id().optional() }), req.query);
  res.json(await events.list(req.actor, { scope: q.scope, communityId: q.communityId, cursor: q.cursor, limit: q.limit ?? 20 }));
}

export async function create(req: Request, res: Response) {
  const body = parse(z.object({ communityId: id().nullable(), ...fields }), req.body);
  res.status(201).json(await events.create(actorOf(req), body));
}

export async function get(req: Request, res: Response) {
  res.json(await events.get(req.actor, parse(idParam, req.params).id));
}

export async function update(req: Request, res: Response) {
  res.json(await events.update(actorOf(req), parse(idParam, req.params).id, parse(z.object(fields).partial(), req.body)));
}

export async function cancel(req: Request, res: Response) {
  await events.cancel(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function rsvp(req: Request, res: Response) {
  const { status } = parse(z.object({ status: z.enum(["GOING", "INTERESTED"]) }), req.body);
  res.json(await events.rsvp(actorOf(req), parse(idParam, req.params).id, status));
}

export async function unrsvp(req: Request, res: Response) {
  res.json(await events.unrsvp(actorOf(req), parse(idParam, req.params).id));
}

export async function attendees(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ status: z.enum(["GOING", "WAITLISTED", "INTERESTED"]).optional() }), req.query);
  res.json(await events.attendees(req.actor, parse(idParam, req.params).id, { status: q.status, cursor: q.cursor, limit: q.limit ?? 20 }));
}

export async function ics(req: Request, res: Response) {
  const out = await events.ics(req.actor, parse(idParam, req.params).id);
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(out.body);
}
