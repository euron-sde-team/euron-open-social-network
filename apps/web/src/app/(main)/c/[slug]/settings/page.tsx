import { TwoColumn } from "@/components/shell/layouts";
import { RequireAuth } from "@/components/common/require-auth";
import { CommunitySettings } from "@/components/communities/settings";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <TwoColumn max="max-w-3xl">
      <RequireAuth>
        <CommunitySettings slug={decodeURIComponent(slug)} />
      </RequireAuth>
    </TwoColumn>
  );
}
