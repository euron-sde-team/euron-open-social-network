import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const saveBlob = vi.fn();
vi.mock("@/lib/download", () => ({ saveBlob: (...a: unknown[]) => saveBlob(...a) }));

import { RecoveryCodes, recoveryCodesText } from "@/components/settings/recovery-codes";

const codes = ["aaaa-1111", "bbbb-2222", "cccc-3333"];

describe("RecoveryCodes", () => {
  it("shows every code and keeps Done disabled until the user confirms they saved them", async () => {
    const onDone = vi.fn();
    render(<RecoveryCodes codes={codes} productName="Open Social" onDone={onDone} />);
    for (const c of codes) expect(screen.getByText(c)).toBeInTheDocument();
    const done = screen.getByTestId("recovery-done");
    expect(done).toBeDisabled();
    await userEvent.click(screen.getByTestId("recovery-saved"));
    expect(done).toBeEnabled();
    await userEvent.click(done);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("copies the codes and downloads them as a text file", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    render(<RecoveryCodes codes={codes} productName="Open Social" onDone={() => undefined} />);
    await user.click(screen.getByTestId("recovery-copy"));
    expect(writeText).toHaveBeenCalledWith(codes.join("\n"));
    await user.click(screen.getByTestId("recovery-download"));
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), "recovery-codes.txt");
  });

  it("writes one code per line under a header", () => {
    const text = recoveryCodesText(codes, "Open Social");
    expect(text.split("\n")).toEqual(["Open Social recovery codes", "Each code signs you in once if you lose your authenticator app.", "", ...codes, ""]);
  });
});
