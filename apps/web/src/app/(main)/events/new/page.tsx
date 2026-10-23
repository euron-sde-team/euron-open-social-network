import { TwoColumn } from "@/components/shell/layouts";
import { RequireAuth } from "@/components/common/require-auth";
import { PageTitle } from "@/components/common/states";
import { EventForm } from "@/components/events/event-form";

export const metadata = { title: "Create event" };

export default async function Page({ searchParams }: { searchParams: Promise<{ communityId?: string }> }) {
  const { communityId } = await searchParams;
  return (
    <TwoColumn max="max-w-[760px]">
      <RequireAuth>
        <PageTitle title="Create event" description="Bring people together, online or in person." />
        <EventForm communityId={typeof communityId === "string" ? communityId : undefined} />
      </RequireAuth>
    </TwoColumn>
  );
}
