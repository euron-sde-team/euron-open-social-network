import { ThreeColumn } from "@/components/shell/layouts";
import { RequireAuth } from "@/components/common/require-auth";
import { SavedPage } from "@/components/discover/saved-page";

export const metadata = { title: "Saved" };

export default function Page() {
  return (
    <ThreeColumn>
      <RequireAuth>
        <SavedPage />
      </RequireAuth>
    </ThreeColumn>
  );
}
