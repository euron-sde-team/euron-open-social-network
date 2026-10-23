/** /api/events: community and network-wide events, RSVPs with capacity and a waitlist, calendar export. */
import { Router } from "express";
import * as ctrl from "../controllers/event.controller";
import { authenticate, optionalAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

const rsvps = rateLimit("rsvps", 60, 60);

/** Events (`Page<CommunityEvent>`): `scope=upcoming|past|going|organising`, `communityId`. */
router.get("/", optionalAuth, ctrl.list);
/** Create (201 `CommunityEvent`). Network-wide events (`communityId: null`) follow settings.networkWideEvents. */
router.post("/", authenticate, rateLimit("event-create", 10, 3600), ctrl.create);
/** An event (`CommunityEvent`); `virtualLink` only for people GOING and the organiser. */
router.get("/:id", optionalAuth, ctrl.get);
/** Edit (organiser or mod). Notifies attendees (EVENT_UPDATED); raising capacity promotes the waitlist. */
router.patch("/:id", authenticate, ctrl.update);
/** Cancel (organiser or mod). 204; notifies attendees (EVENT_CANCELLED). */
router.delete("/:id", authenticate, ctrl.cancel);
/** RSVP: `{ status: GOING | INTERESTED }`. GOING past capacity becomes WAITLISTED. */
router.put("/:id/rsvp", authenticate, rsvps, ctrl.rsvp);
/** Remove your RSVP; promotes the first person on the waitlist (EVENT_PROMOTED). */
router.delete("/:id/rsvp", authenticate, rsvps, ctrl.unrsvp);
/** Attendees (`Page<{ user, status }>`), `status` filter. */
router.get("/:id/attendees", optionalAuth, ctrl.attendees);
/** The event as an iCalendar file (`text/calendar`). */
router.get("/:id/ics", optionalAuth, ctrl.ics);
