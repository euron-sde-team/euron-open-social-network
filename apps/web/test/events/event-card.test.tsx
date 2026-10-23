import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventCard } from "@/components/events/event-card";
import { makeEvent } from "./fixtures";

describe("<EventCard>", () => {
  it("shows title, place, counts and links to the event", () => {
    render(<EventCard event={makeEvent()} />);
    expect(screen.getByText("Community meetup")).toBeInTheDocument();
    expect(screen.getByText("Main hall")).toBeInTheDocument();
    expect(screen.getByText(/3 going, 1 interested/)).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/events/01J0000000000000000000000E");
  });
  it("marks online events and the viewer's RSVP", () => {
    render(<EventCard event={makeEvent({ isVirtual: true, viewer: { rsvp: "WAITLISTED", waitlistPosition: null, canEdit: false } })} />);
    expect(screen.getByText("Online event")).toBeInTheDocument();
    expect(screen.getByTestId("rsvp-badge")).toHaveTextContent("Waitlist");
  });
  it("shows the cancelled state", () => {
    render(<EventCard event={makeEvent({ status: "CANCELLED", community: null })} />);
    expect(screen.getAllByText("Cancelled").length).toBeGreaterThan(0);
    expect(screen.getByText("Network-wide")).toBeInTheDocument();
  });
});
