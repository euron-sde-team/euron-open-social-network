import { Suspense } from "react";
import type { Metadata } from "next";
import { TwoColumn } from "@/components/shell/layouts";
import { RequireAuth } from "@/components/common/require-auth";
import { SettingsPage } from "@/components/settings/settings-page";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return (
    <TwoColumn max="max-w-[960px]">
      <RequireAuth>
        <Suspense>
          <SettingsPage />
        </Suspense>
      </RequireAuth>
    </TwoColumn>
  );
}
