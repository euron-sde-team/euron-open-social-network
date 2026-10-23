import { ThreeColumn } from "@/components/shell/layouts";
import { LeaderboardPage } from "@/components/discover/leaderboard-page";

export const metadata = { title: "Leaderboard" };

export default function Page() {
  return (
    <ThreeColumn>
      <LeaderboardPage />
    </ThreeColumn>
  );
}
