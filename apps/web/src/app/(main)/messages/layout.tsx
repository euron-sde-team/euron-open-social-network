import { RequireAuth } from "@/components/common/require-auth";
import { FullWidth } from "@/components/shell/layouts";
import { MessagesShell } from "@/components/messages/messages-shell";

export const metadata = { title: "Messages" };

/** The shell stays mounted while moving between conversations; the pages themselves render nothing. */
export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  return (
    <FullWidth>
      <RequireAuth>
        <MessagesShell />
      </RequireAuth>
      {children}
    </FullWidth>
  );
}
