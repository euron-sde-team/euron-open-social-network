import type { Metadata } from "next";
import { TwoColumn } from "@/components/shell/layouts";
import { RequireAuth } from "@/components/common/require-auth";
import { ModerationDesk } from "@/components/moderation/moderation-desk";

export const metadata: Metadata = { title: "Moderation desk" };

export default function Page() {
  return (
    <TwoColumn max="max-w-[1200px]">
      <RequireAuth>
        <ModerationDesk />
      </RequireAuth>
    </TwoColumn>
  );
}
