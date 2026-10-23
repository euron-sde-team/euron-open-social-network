"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Search, X } from "lucide-react";
import { Avatar, Skeleton, cn } from "@open-social/ui";
import type { UserSummary } from "@open-social/types";
import { api } from "@/lib/api";
import { useContacts } from "@/lib/hooks/queries";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { qk } from "@/lib/query-keys";

/**
 * Find people to message: contacts first, then /discover/typeahead matches as
 * you type. Single or multiple selection.
 */
export function PeoplePicker({
  selected,
  onToggle,
  multi,
  excludeIds,
  autoFocus,
}: {
  selected: UserSummary[];
  onToggle: (u: UserSummary) => void;
  multi?: boolean;
  excludeIds?: Set<string>;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim(), 180);
  const contacts = useContacts();
  const search = useQuery({
    queryKey: qk.typeahead(term),
    queryFn: ({ signal }) => api().discover.typeahead(term, signal),
    enabled: term.length >= 2,
    staleTime: 60_000,
    meta: { silent: true },
  });

  const people = useMemo(() => {
    const lower = term.toLowerCase();
    const fromContacts = (contacts.data ?? [])
      .filter((c) => !lower || c.user.displayName.toLowerCase().includes(lower) || c.user.username.toLowerCase().includes(lower))
      .map((c) => ({ user: c.user, online: c.online }));
    const seen = new Set(fromContacts.map((p) => p.user.id));
    const fromSearch = term.length >= 2 ? (search.data?.people ?? []).filter((u) => !seen.has(u.id)).map((u) => ({ user: u, online: false })) : [];
    return [...fromContacts, ...fromSearch].filter((p) => !excludeIds?.has(p.user.id)).slice(0, 30);
  }, [contacts.data, search.data, term, excludeIds]);

  const isSelected = (id: string) => selected.some((s) => s.id === id);

  return (
    <div className="space-y-2">
      {multi && selected.length ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((u) => (
            <span key={u.id} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-primary-soft pl-1 pr-1.5 text-xs font-semibold text-primary-soft-foreground">
              <Avatar name={u.displayName} seed={u.id} src={u.avatarUrl} size="xs" />
              {u.displayName}
              <button type="button" aria-label={`Remove ${u.displayName}`} onClick={() => onToggle(u)} className="rounded-full p-0.5 hover:bg-card">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus={autoFocus}
          placeholder="Search for people"
          aria-label="Search for people"
          data-testid="new-message-search"
          className="h-10 w-full rounded-full bg-muted pl-9 pr-3 text-sm placeholder:text-subtle-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      </div>
      <ul className="max-h-72 overflow-y-auto" role="listbox" aria-multiselectable={multi || undefined} aria-label="People">
        {contacts.isPending ? (
          Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="flex items-center gap-3 px-2 py-2">
              <Skeleton className="size-9 rounded-full" />
              <Skeleton className="h-3 flex-1" />
            </li>
          ))
        ) : people.length === 0 ? (
          <li className="px-2 py-6 text-center text-sm text-subtle-foreground">{term.length >= 2 ? "Nobody matches that search." : "Type a name to find people."}</li>
        ) : (
          people.map(({ user: u, online }) => {
            const sel = isSelected(u.id);
            return (
              <li key={u.id} role="option" aria-selected={sel}>
                <button
                  type="button"
                  onClick={() => onToggle(u)}
                  data-testid="person-option"
                  className={cn("flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted", sel && "bg-primary/10")}
                >
                  <Avatar name={u.displayName} seed={u.id} src={u.avatarUrl} size="sm" online={online} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{u.displayName}</span>
                    <span className="block truncate text-xs text-subtle-foreground">@{u.username}</span>
                  </span>
                  {multi ? (
                    <span className={cn("flex size-5 items-center justify-center rounded-full border", sel ? "border-primary bg-primary text-primary-foreground" : "border-input")} aria-hidden>
                      {sel ? <Check className="size-3" /> : null}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
