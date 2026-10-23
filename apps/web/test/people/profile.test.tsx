import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@open-social/ui";
import type { Profile, SearchResults } from "@open-social/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/u/lin", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ status: "signed-in", user: { id: "me" } }) }));

const { ProfileActions } = await import("@/components/profile/profile-header");
const { displayUrl, parseProfileTab } = await import("@/components/profile/profile-page");
const { isEmptyResults, parseSearchType } = await import("@/components/discover/search-page");

function profile(over: Partial<Profile["viewer"]> = {}): Profile {
  return {
    id: "u2",
    username: "lin",
    displayName: "Lin Park",
    avatarUrl: null,
    headline: null,
    role: "USER",
    bio: null,
    location: null,
    website: null,
    coverUrl: null,
    reputation: 10,
    level: 2,
    postCount: 3,
    followerCount: 5,
    followingCount: 2,
    joinedAt: "2026-01-01T00:00:00.000Z",
    viewer: { isSelf: false, following: false, followedBy: false, blocked: false, canMessage: true, messageBlockedReason: null, ...over },
  };
}

function renderActions(p: Profile) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <ProfileActions profile={p} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("<ProfileActions>", () => {
  it("offers follow and message for someone you can message", () => {
    renderActions(profile());
    expect(screen.getByTestId("follow-button")).toHaveTextContent("Follow");
    expect(screen.getByTestId("message-button")).toBeEnabled();
  });
  it("disables Message with the denial reason when DMs are not allowed", () => {
    renderActions(profile({ canMessage: false, messageBlockedReason: "RECIPIENT_DISABLED_DMS", following: true }));
    expect(screen.getByTestId("message-button")).toBeDisabled();
    expect(screen.getByText("Lin Park has turned off direct messages.")).toHaveClass("sr-only");
    expect(screen.getByTestId("follow-button")).toHaveTextContent("Following");
  });
  it("shows Edit profile on your own profile", () => {
    renderActions(profile({ isSelf: true }));
    expect(screen.getByTestId("edit-profile")).toHaveAttribute("href", "/settings");
    expect(screen.queryByTestId("follow-button")).toBeNull();
  });
  it("shows Unblock instead of follow when blocked", () => {
    renderActions(profile({ blocked: true }));
    expect(screen.getByTestId("unblock-button")).toBeInTheDocument();
    expect(screen.queryByTestId("message-button")).toBeNull();
  });
});

describe("profile and search helpers", () => {
  it("parses tabs with a posts default", () => {
    expect(parseProfileTab("media")).toBe("media");
    expect(parseProfileTab("bogus")).toBe("posts");
    expect(parseProfileTab(null)).toBe("posts");
    expect(parseSearchType("people")).toBe("people");
    expect(parseSearchType("x")).toBe("all");
  });
  it("shows websites without the scheme", () => {
    expect(displayUrl("https://example.org/")).toBe("example.org");
    expect(displayUrl("https://example.org/me/")).toBe("example.org/me");
  });
  it("detects empty search results", () => {
    const empty: SearchResults = { people: [], communities: [], posts: [], questions: [] };
    expect(isEmptyResults(empty)).toBe(true);
    expect(isEmptyResults(undefined)).toBe(true);
    expect(isEmptyResults({ ...empty, people: [profile()] })).toBe(false);
  });
});
