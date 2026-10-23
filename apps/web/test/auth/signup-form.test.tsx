import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
const acceptSession = vi.fn();
const signup = vi.fn();
let search = new URLSearchParams();
let registration: "OPEN" | "INVITE_ONLY" | "CLOSED" = "OPEN";

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ acceptSession, status: "signed-out" }) }));
vi.mock("@/lib/meta", () => ({ useNetworkMeta: () => ({ data: { networkName: "Book Club", registration } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }), useSearchParams: () => search }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/api", () => ({ api: () => ({ auth: { signup } }) }));

import { SignupForm, needsInviteCode } from "@/components/auth/signup-form";

async function fill() {
  await userEvent.type(screen.getByLabelText("Email"), "ada@example.org");
  await userEvent.type(screen.getByLabelText("Name"), "Ada");
  await userEvent.type(screen.getByLabelText("Username"), "ada");
  await userEvent.type(screen.getByLabelText("Password"), "a long enough password");
}

describe("SignupForm invite code", () => {
  beforeEach(() => {
    signup.mockReset().mockResolvedValue({ verificationRequired: true, email: "ada@example.org" });
    search = new URLSearchParams();
    registration = "OPEN";
  });

  it("asks for a code only on invite-only networks", () => {
    expect(needsInviteCode("INVITE_ONLY")).toBe(true);
    expect(needsInviteCode("OPEN")).toBe(false);
    render(<SignupForm />);
    expect(screen.queryByTestId("signup-invite-code")).not.toBeInTheDocument();
  });

  it("pre-fills the code from ?invite= and sends it", async () => {
    registration = "INVITE_ONLY";
    search = new URLSearchParams({ invite: "abc123" });
    render(<SignupForm />);
    expect(screen.getByTestId("signup-invite-code")).toHaveValue("abc123");
    await fill();
    await userEvent.click(screen.getByTestId("signup-submit"));
    await waitFor(() => expect(signup).toHaveBeenCalledWith(expect.objectContaining({ inviteCode: "abc123", username: "ada" })));
  });

  it("requires the code before calling the API on invite-only networks", async () => {
    registration = "INVITE_ONLY";
    render(<SignupForm />);
    await fill();
    await userEvent.click(screen.getByTestId("signup-submit"));
    expect(await screen.findByText("Enter the invite code you were given")).toBeInTheDocument();
    expect(signup).not.toHaveBeenCalled();
  });
});
