import { ThreeColumn } from "@/components/shell/layouts";
import { RequireAuth } from "@/components/common/require-auth";
import { NotificationsPage } from "@/components/notifications/notifications-page";

export const metadata = { title: "Notifications" };

export default function Page() {
  return (
    <ThreeColumn>
      <RequireAuth>
        <NotificationsPage />
      </RequireAuth>
    </ThreeColumn>
  );
}
