"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { Avatar, Spinner, cn } from "@open-social/ui";
import { api } from "@/lib/api";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { qk } from "@/lib/query-keys";
import { compactNumber } from "@/lib/time";

type Option = { key: string; href: string; label: string; meta: string; kind: "person" | "community" | "search"; avatar?: { id: string; name: string; src: string | null; square?: boolean } };

/** Header typeahead: people and communities as you type, arrow keys to move, Enter to go. */
export function SearchBox({ className, autoFocus, onNavigate }: { className?: string; autoFocus?: boolean; onNavigate?: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounced = useDebounced(q.trim(), 180);
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);

  const { data, isFetching } = useQuery({
    queryKey: qk.typeahead(debounced),
    queryFn: ({ signal }) => api().discover.typeahead(debounced, signal),
    enabled: debounced.length >= 2,
    staleTime: 60_000,
    meta: { silent: true },
  });

  const options = useMemo<Option[]>(() => {
    const out: Option[] = [];
    for (const p of data?.people ?? []) {
      out.push({ key: `p-${p.id}`, href: `/u/${encodeURIComponent(p.username)}`, label: p.displayName, meta: `@${p.username}`, kind: "person", avatar: { id: p.id, name: p.displayName, src: p.avatarUrl } });
    }
    for (const c of data?.communities ?? []) {
      out.push({ key: `c-${c.id}`, href: `/c/${encodeURIComponent(c.slug)}`, label: c.name, meta: `Community, ${compactNumber(c.memberCount)} members`, kind: "community", avatar: { id: c.id, name: c.name, src: c.iconUrl, square: true } });
    }
    if (q.trim().length >= 2) out.push({ key: "search", href: `/search?q=${encodeURIComponent(q.trim())}`, label: `Search for "${q.trim()}"`, meta: "Posts, people, communities and questions", kind: "search" });
    return out;
  }, [data, q]);

  useEffect(() => setActive(-1), [debounced]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    onNavigate?.();
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (options.length ? (a + 1) % options.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (options.length ? (a <= 0 ? options.length - 1 : a - 1) : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = options[active];
      if (opt) go(opt.href);
      else if (q.trim().length >= 2) go(`/search?q=${encodeURIComponent(q.trim())}`);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  };

  const showList = open && q.trim().length >= 2;

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden />
        <input
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          aria-label="Search people, communities and posts"
          placeholder="Search"
          autoFocus={autoFocus}
          value={q}
          data-testid="search-input"
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-10 w-full rounded-full border border-transparent bg-muted pl-9 pr-9 text-sm text-foreground placeholder:text-subtle-foreground focus-visible:border-ring focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 [&::-webkit-search-cancel-button]:hidden"
        />
        {q ? (
          <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-subtle-foreground hover:bg-card hover:text-foreground">
            {isFetching ? <Spinner size="sm" /> : <X className="size-4" />}
          </button>
        ) : null}
      </div>
      {showList ? (
        <ul id={listId} role="listbox" aria-label="Suggestions" className="absolute left-0 right-0 top-12 z-[70] max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-popover animate-pop-in">
          {options.length === 1 && !isFetching && debounced.length >= 2 ? <li className="px-3 py-2 text-xs text-subtle-foreground">No people or communities match</li> : null}
          {options.map((o, i) => (
            <li
              key={o.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                go(o.href);
              }}
              className={cn("flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2", i === active && "bg-muted")}
            >
              {o.avatar ? (
                <Avatar name={o.avatar.name} seed={o.avatar.id} src={o.avatar.src} size="sm" shape={o.avatar.square ? "square" : "circle"} />
              ) : (
                <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
                  <Search className="size-4" />
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{o.label}</span>
                <span className="block truncate text-xs text-subtle-foreground">{o.meta}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
