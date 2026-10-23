import { ThreeColumn } from "@/components/shell/layouts";
import { PeopleList } from "@/components/profile/people-list";

export default async function Page({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return (
    <ThreeColumn>
      <PeopleList username={decodeURIComponent(username)} kind="followers" />
    </ThreeColumn>
  );
}
