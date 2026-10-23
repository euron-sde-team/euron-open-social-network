import { TwoColumn } from "@/components/shell/layouts";
import { EventDetail } from "@/components/events/event-detail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <TwoColumn>
      <EventDetail id={id} />
    </TwoColumn>
  );
}
