"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button, Tabs, TabsList, TabsTrigger } from "@open-social/ui";
import { useAuth } from "@/lib/auth";
import { PageTitle } from "@/components/common/states";
import { EventList, type EventScope } from "./event-list";

const TABS: { value: EventScope; label: string; empty: string; auth?: boolean }[] = [
  { value: "upcoming", label: "Upcoming", empty: "No upcoming events" },
  { value: "going", label: "Going", empty: "You are not going to anything yet", auth: true },
  { value: "organising", label: "Organising", empty: "You are not organising any events", auth: true },
  { value: "past", label: "Past", empty: "No past events" },
];

export function EventsPage() {
  const { status } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabs = TABS.filter((t) => !t.auth || status === "signed-in");
  const current = tabs.find((t) => t.value === params.get("tab")) ?? tabs[0]!;
  return (
    <>
      <PageTitle
        title="Events"
        description="Meetups, workshops and calls from your communities."
        actions={
          status === "signed-in" ? (
            <Button asChild data-testid="create-event">
              <Link href="/events/new">
                <Plus /> Create event
              </Link>
            </Button>
          ) : undefined
        }
      />
      <Tabs value={current.value} onValueChange={(v) => router.replace(v === "upcoming" ? pathname : `${pathname}?tab=${v}`, { scroll: false })}>
        <TabsList className="mb-4" aria-label="Event lists">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value} data-testid={`events-tab-${t.value}`}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <EventList key={current.value} scope={current.value} emptyText={current.empty} />
    </>
  );
}
