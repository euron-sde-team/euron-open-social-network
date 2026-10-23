import { describe, expect, it } from "vitest";
import { ApiError } from "@open-social/api-client";
import { exportErrorMessage, ownedCommunities } from "@/lib/account";
import { exportFileName } from "@/lib/download";
import { resolveProductName } from "@/lib/meta";
import { inviteLinks } from "@/components/communities/invite-gate";

const fallback = () => "fallback";

describe("data export", () => {
  it("names the file after the username", () => {
    expect(exportFileName("ada_l")).toBe("ada_l-export.json");
    expect(exportFileName("a/b")).toBe("a_b-export.json");
  });
  it("explains the daily limit on 429", () => {
    expect(exportErrorMessage(new ApiError({ status: 429, code: "RATE_LIMITED", message: "x" }), fallback)).toBe("You can export 3 times a day. Try again tomorrow.");
    expect(exportErrorMessage(new ApiError({ status: 500, code: "SERVER_ERROR", message: "x" }), fallback)).toBe("fallback");
  });
});

describe("account deletion", () => {
  it("lists the communities to transfer when the API names them", () => {
    const e = new ApiError({ status: 409, code: "OWNER_MUST_TRANSFER", message: "x", details: { communities: [{ id: "c1", slug: "books", name: "Books" }, "Chess", 4] } });
    expect(ownedCommunities(e)).toEqual([{ name: "Books", slug: "books" }, { name: "Chess" }]);
  });
  it("falls back to generic copy without details, and ignores other errors", () => {
    expect(ownedCommunities(new ApiError({ status: 409, code: "OWNER_MUST_TRANSFER", message: "x" }))).toEqual([]);
    expect(ownedCommunities(new ApiError({ status: 401, code: "INVALID_CREDENTIALS", message: "x" }))).toBeNull();
  });
});

describe("network meta", () => {
  it("uses the network name when set, else the runtime product name", () => {
    expect(resolveProductName({ networkName: "Book Club" }, "Open Social")).toBe("Book Club");
    expect(resolveProductName({ networkName: "  " }, "Open Social")).toBe("Open Social");
    expect(resolveProductName(undefined, "Open Social")).toBe("Open Social");
  });
  it("sends signed-out invitees to signup with the code and back to the invite", () => {
    expect(inviteLinks("abc123")).toEqual({ signup: "/signup?invite=abc123&next=%2Finvite%2Fabc123", login: "/login?next=%2Finvite%2Fabc123" });
  });
});
