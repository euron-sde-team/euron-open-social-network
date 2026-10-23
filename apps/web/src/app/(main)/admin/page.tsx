import { Suspense } from "react";
import type { Metadata } from "next";
import { TwoColumn } from "@/components/shell/layouts";
import { RequireAuth } from "@/components/common/require-auth";
import { AdminPage } from "@/components/admin/admin-page";

export const metadata: Metadata = { title: "Administration" };

export default function Page() {
  return (
    <TwoColumn max="max-w-[1200px]">
      <RequireAuth role="staff">
        <Suspense>
          <AdminPage />
        </Suspense>
      </RequireAuth>
    </TwoColumn>
  );
}
