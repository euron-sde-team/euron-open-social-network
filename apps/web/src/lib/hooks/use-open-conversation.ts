"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { isApiError } from "@open-social/api-client";
import { toast } from "@open-social/ui";
import type { DmDenialReason, UserSummary } from "@open-social/types";
import { api } from "../api";
import { dmDenialCopy } from "../errors";
import { qk } from "../query-keys";
import { useDock } from "../stores/dock";

/**
 * Open (find or create) a direct conversation with someone: in the dock on
 * desktop, as the full page on small screens.
 */
export function useOpenConversation() {
  const qc = useQueryClient();
  const router = useRouter();
  const openThread = useDock((s) => s.openThread);
  return useMutation({
    mutationFn: (user: Pick<UserSummary, "id" | "displayName">) => api().dms.open(user.id),
    meta: { silent: true },
    onSuccess: (thread) => {
      qc.setQueryData(qk.thread(thread.id), thread);
      if (typeof window !== "undefined" && window.innerWidth < 1024) router.push(`/messages/${thread.id}`);
      else openThread(thread.id);
    },
    onError: (e, user) => {
      if (isApiError(e) && e.code === "DM_NOT_ALLOWED") toast.error({ title: dmDenialCopy(e.reason as DmDenialReason | null, user.displayName) });
      else toast.error({ title: "Could not open the conversation", description: isApiError(e) ? e.message : undefined });
    },
  });
}
