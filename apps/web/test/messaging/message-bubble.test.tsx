import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@open-social/ui";
import { MessageBubble } from "@/components/chat/message-bubble";
import { msg } from "./fixtures";

const wrap = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>);

describe("<MessageBubble>", () => {
  it("renders the body, reply quote and receipt", () => {
    wrap(
      <MessageBubble
        own
        message={msg("1", "me", "2026-01-01T10:00:00Z", { body: "hello there", replyTo: { id: "0", body: "earlier", senderName: "Ada" } })}
        receipt="Seen"
      />,
    );
    expect(screen.getByText("hello there")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByTestId("dm-seen")).toHaveTextContent("Seen");
    expect(screen.getByTestId("message-bubble")).toHaveAttribute("data-own", "true");
  });

  it("shows removed and pending states", () => {
    const { rerender } = wrap(<MessageBubble own={false} message={msg("1", "a", "2026-01-01T10:00:00Z", { status: "REMOVED" })} />);
    expect(screen.getByText("This message was removed")).toBeInTheDocument();
    rerender(
      <TooltipProvider>
        <MessageBubble own message={msg("tmp_1", "me", "2026-01-01T10:00:00Z")} />
      </TooltipProvider>,
    );
    expect(screen.getByText("Sending...")).toBeInTheDocument();
    expect(screen.queryByTestId("message-actions")).not.toBeInTheDocument();
  });

  it("toggles a reaction chip and fires reply", async () => {
    const onReact = vi.fn();
    const onReply = vi.fn();
    const m = msg("1", "a", "2026-01-01T10:00:00Z", { reactions: [{ emoji: "X", count: 2, reactedByViewer: true }] });
    wrap(<MessageBubble own={false} message={m} actions={{ onReact, onReply }} />);
    await userEvent.click(screen.getByRole("button", { name: /X 2, you reacted/ }));
    expect(onReact).toHaveBeenCalledWith(m, "X");
    await userEvent.click(screen.getByTestId("message-reply"));
    expect(onReply).toHaveBeenCalledWith(m);
  });
});
