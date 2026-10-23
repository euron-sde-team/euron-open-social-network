import { ThreeColumn } from "@/components/shell/layouts";
import { PostDetail } from "@/components/posts/post-detail";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ThreeColumn>
      <PostDetail id={id} />
    </ThreeColumn>
  );
}
