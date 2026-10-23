import { TwoColumn } from "@/components/shell/layouts";
import { InviteGate } from "@/components/communities/invite-gate";

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <TwoColumn max="max-w-xl">
      <InviteGate code={decodeURIComponent(code)} />
    </TwoColumn>
  );
}
