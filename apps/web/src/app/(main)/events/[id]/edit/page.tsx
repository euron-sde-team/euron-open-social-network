import { TwoColumn } from "@/components/shell/layouts";
import { RequireAuth } from "@/components/common/require-auth";
import { EditEvent } from "@/components/events/edit-event";

export const metadata = { title: "Edit event" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <TwoColumn max="max-w-[760px]">
      <RequireAuth>
        <EditEvent id={id} />
      </RequireAuth>
    </TwoColumn>
  );
}
