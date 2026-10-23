"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { Button, Card, EmptyState, toast } from "@open-social/ui";
import { api } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { errorCopy } from "@/lib/errors";
import { PageTitle } from "@/components/common/states";
import { CommunityForm } from "./community-form";

export function CreateCommunity() {
  const router = useRouter();
  const qc = useQueryClient();
  const [restricted, setRestricted] = useState<string | null>(null);

  if (restricted) {
    return (
      <Card data-testid="community-creation-restricted">
        <EmptyState
          icon={<ShieldAlert />}
          title={restricted === "COMMUNITY_LIMIT_REACHED" ? "You have reached your community limit" : "Community creation is limited on this network"}
          description={
            restricted === "COMMUNITY_LIMIT_REACHED"
              ? `${errorCopy(restricted)} Hand one over to another member or ask an admin to raise the limit.`
              : `${errorCopy(restricted)} You can still join communities and ask a moderator to create one for you.`
          }
          action={
            <Button asChild variant="soft">
              <Link href="/communities">Browse communities</Link>
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="Create a community" description="Bring people together around a topic, a place or a project." />
      <CommunityForm
        mode="create"
        onRestricted={setRestricted}
        onSubmit={async (values) => {
          const c = await api().communities.create(values);
          qc.setQueryData(qk.community(c.slug), c);
          void qc.invalidateQueries({ queryKey: qk.communitiesAll });
          toast.success({ title: `${c.name} is ready`, description: "Invite people and write a welcome post." });
          router.push(`/c/${encodeURIComponent(c.slug)}`);
        }}
      />
    </div>
  );
}
