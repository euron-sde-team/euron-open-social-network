import { FullWidth } from "@/components/shell/layouts";
import { CommunityPage } from "@/components/communities/community-page";

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <FullWidth>
      <CommunityPage slug={decodeURIComponent(slug)} />
    </FullWidth>
  );
}
