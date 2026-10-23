import type { Metadata } from "next";
import { TwoColumn } from "@/components/shell/layouts";
import { RequireAuth } from "@/components/common/require-auth";
import { CreateCommunity } from "@/components/communities/create-community";

export const metadata: Metadata = { title: "Create a community" };

export default function NewCommunityPage() {
  return (
    <TwoColumn max="max-w-3xl">
      <RequireAuth>
        <CreateCommunity />
      </RequireAuth>
    </TwoColumn>
  );
}
