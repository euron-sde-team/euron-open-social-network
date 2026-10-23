import { Suspense } from "react";
import { TwoColumn } from "@/components/shell/layouts";
import { EventsPage } from "@/components/events/events-page";

export const metadata = { title: "Events" };

export default function Page() {
  return (
    <TwoColumn>
      <Suspense>
        <EventsPage />
      </Suspense>
    </TwoColumn>
  );
}
