import { ThreeColumn } from "@/components/shell/layouts";
import { TagPage } from "@/components/discover/tag-page";

export default async function Page({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params;
  return (
    <ThreeColumn>
      <TagPage tag={decodeURIComponent(tag).toLowerCase()} />
    </ThreeColumn>
  );
}
