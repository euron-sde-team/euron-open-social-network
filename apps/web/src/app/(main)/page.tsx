import { ThreeColumn } from "@/components/shell/layouts";
import { HomeFeed } from "@/components/feed/home-feed";

export default function HomePage() {
  return (
    <ThreeColumn>
      <HomeFeed />
    </ThreeColumn>
  );
}
