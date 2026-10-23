import { Suspense } from "react";
import { ThreeColumn } from "@/components/shell/layouts";
import { SearchPage } from "@/components/discover/search-page";

export const metadata = { title: "Search" };

export default function Page() {
  return (
    <ThreeColumn>
      <Suspense>
        <SearchPage />
      </Suspense>
    </ThreeColumn>
  );
}
