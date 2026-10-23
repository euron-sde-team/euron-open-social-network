"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@open-social/ui";
import { useAuth } from "@/lib/auth";
import { PageTitle } from "@/components/common/states";
import { AdminOverview } from "./overview";
import { AdminUsers } from "./users";
import { AdminCommunities } from "./communities";
import { AdminSettings } from "./settings-form";
import { AdminAudit } from "./audit";

export function AdminPage() {
  const { isAdmin } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "users", label: "People" },
    { id: "communities", label: "Communities" },
    ...(isAdmin ? [{ id: "settings", label: "Settings" }, { id: "audit", label: "Audit log" }] : []),
  ];
  const tab = tabs.find((t) => t.id === params.get("tab"))?.id ?? "overview";
  return (
    <div>
      <PageTitle title={isAdmin ? "Administration" : "Network overview"} description={isAdmin ? "Run the network: people, communities, policies and the audit trail." : "Network health and accounts. Changes to settings and roles are for admins."} />
      <Tabs value={tab} onValueChange={(v) => router.replace(`${pathname}?tab=${v}`, { scroll: false })}>
        <TabsList className="mb-4">
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id} data-testid={`admin-tab-${t.id}`}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">
          <AdminOverview />
        </TabsContent>
        <TabsContent value="users">
          <AdminUsers />
        </TabsContent>
        <TabsContent value="communities">
          <AdminCommunities />
        </TabsContent>
        {isAdmin ? (
          <>
            <TabsContent value="settings">
              <AdminSettings />
            </TabsContent>
            <TabsContent value="audit">
              <AdminAudit />
            </TabsContent>
          </>
        ) : null}
      </Tabs>
    </div>
  );
}
