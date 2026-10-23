import type { Metadata } from "next";
import { TwoColumn } from "@/components/shell/layouts";
import { RequireAuth } from "@/components/common/require-auth";
import { MyCaseDetail } from "@/components/moderation/my-cases";

export const metadata: Metadata = { title: "Content review" };

export default async function Page({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return (
    <TwoColumn max="max-w-[820px]">
      <RequireAuth>
        <MyCaseDetail caseId={caseId} />
      </RequireAuth>
    </TwoColumn>
  );
}
