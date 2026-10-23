import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MarkdownLite } from "@/components/questions/markdown-lite";
import { VoteControl } from "@/components/questions/vote-control";

describe("MarkdownLite", () => {
  it("renders paragraphs, fenced code and inline code", () => {
    const { container } = render(<MarkdownLite text={"First para with `npm i`.\n\nSecond para\n\n```ts\nconst a = 1;\n```"} />);
    const ps = container.querySelectorAll("p");
    expect(ps).toHaveLength(2);
    expect(container.querySelector("p code")?.textContent).toBe("npm i");
    const pre = container.querySelector("pre");
    expect(pre?.textContent).toBe("const a = 1;");
    expect(pre?.getAttribute("data-lang")).toBe("ts");
  });

  it("links only http and https, with safe rel", () => {
    render(<MarkdownLite text={"See [docs](https://example.org/a) and [bad](javascript:alert(1)) and https://example.org/b."} />);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["https://example.org/a", "https://example.org/b"]);
    expect(links[0]).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getByText(/\[bad\]/)).toBeInTheDocument();
  });

  it("renders HTML in user text as plain text", () => {
    const { container } = render(<MarkdownLite text={"<img src=x onerror=alert(1)> hello"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});

describe("VoteControl", () => {
  it("shows the score and reports the direction", async () => {
    const onVote = vi.fn();
    render(<VoteControl score={3} vote={1} onVote={onVote} />);
    expect(screen.getByTestId("vote-score")).toHaveTextContent("3");
    expect(screen.getByRole("button", { name: "Upvote" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Downvote" }));
    expect(onVote).toHaveBeenCalledWith(-1);
  });
});
