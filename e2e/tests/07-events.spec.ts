import { expect, test } from "@playwright/test";
import { as, createCommunity, join, newUser, pageFor, uniq } from "../helpers";

test("capacity 1: the second RSVP is waitlisted #1 and is promoted to Going when the first cancels", async ({ browser, request }) => {
  const organiser = await newUser(request);
  const first = await newUser(request, { displayName: "Fay First" });
  const second = await newUser(request, { displayName: "Sam Second" });
  const club = await createCommunity(request, organiser);
  await join(request, first, club);
  await join(request, second, club);
  const startsAt = new Date(Date.now() + 3 * 86_400_000);
  const event = await as<{ id: string; title: string }>(
    request,
    organiser,
    "POST",
    "/events",
    { communityId: club.id, title: `Tiny workshop ${uniq("e")}`, description: "One seat only.", location: "Room 1", startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(), capacity: 1 },
    201,
  );

  const f = await pageFor(browser, first, `/events/${event.id}`);
  await test.step("the first member RSVPs going and takes the only seat", async () => {
    await expect(f.getByTestId("event-detail")).toContainText(event.title);
    await f.getByTestId("rsvp-going").click();
    await expect(f.getByTestId("rsvp-status")).toContainText("You are going.");
    await expect(f.getByTestId("capacity")).toContainText("full");
  });

  const s = await pageFor(browser, second, `/events/${event.id}`);
  await test.step("the second member can only join the waitlist, as #1", async () => {
    await expect(s.getByTestId("rsvp-going")).toHaveText(/Join waitlist/);
    await s.getByTestId("rsvp-going").click();
    await expect(s.getByTestId("rsvp-going")).toHaveText(/On the waitlist/);
    await s.reload();
    await expect(s.getByTestId("rsvp-status")).toContainText("You are #1 on the waitlist. You are next in line.");
  });

  await test.step("the first member cancels and the second is promoted to Going", async () => {
    await f.getByTestId("rsvp-cancel").click();
    await expect(f.getByTestId("rsvp-status")).toHaveCount(0);
    await expect(f.getByTestId("rsvp-going")).toHaveText(/Join waitlist/);
    await s.reload();
    await expect(s.getByTestId("rsvp-status")).toContainText("You are going.");
    await expect(s.getByTestId("rsvp-going")).toHaveText(/Going/);
  });

  await f.context().close();
  await s.context().close();
});
