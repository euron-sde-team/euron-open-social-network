import type { Metadata } from "next";
import { TwoColumn } from "@/components/shell/layouts";
import { CommunityDiscover } from "@/components/communities/discover";

export const metadata: Metadata = { title: "Communities" };

export default function CommunitiesPage() {
  return (
    <TwoColumn>
      <CommunityDiscover />
    </TwoColumn>
  );
}
