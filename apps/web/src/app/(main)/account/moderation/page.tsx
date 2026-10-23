import type { Metadata } from "next";
import { TwoColumn } from "@/components/shell/layouts";
import { RequireAuth } from "@/components/common/require-auth";
import { MyCases } from "@/components/moderation/my-cases";

export const metadata: Metadata = { title: "Your content reviews" };

export default function Page() {
  return (
    <TwoColumn max="max-w-[820px]">
      <RequireAuth>
        <MyCases />
      </RequireAuth>
    </TwoColumn>
  );
}
