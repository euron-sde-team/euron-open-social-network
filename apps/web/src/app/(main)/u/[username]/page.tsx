import { Suspense } from "react";
import { TwoColumn } from "@/components/shell/layouts";
import { ProfilePage } from "@/components/profile/profile-page";

export default async function UserPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return (
    <TwoColumn max="max-w-[1000px]" className="pt-0 sm:pt-4">
      <Suspense>
        <ProfilePage username={decodeURIComponent(username)} />
      </Suspense>
    </TwoColumn>
  );
}
