"use client";

import Link from "next/link";
import { HeartHandshake } from "lucide-react";
import { Button } from "@open-social/ui";
import { useProductName } from "@/lib/meta";
import { AuthHeading } from "./auth-shell";

export function Goodbye() {
  const name = useProductName();
  return (
    <div className="text-center" data-testid="goodbye">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
        <HeartHandshake className="size-6" />
      </div>
      <AuthHeading title="Your account is deleted" description={`Thanks for being part of ${name}. You have been signed out everywhere.`} />
      <Button asChild variant="outline" block>
        <Link href="/communities">Browse communities</Link>
      </Button>
    </div>
  );
}
