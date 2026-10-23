import { Bookmark, CalendarDays, Home, MessageCircle, Trophy, Users } from "lucide-react";

export const PRIMARY_NAV = [
  { href: "/", label: "Home", icon: Home, match: (p: string) => p === "/" },
  { href: "/communities", label: "Communities", icon: Users, match: (p: string) => p.startsWith("/communities") || p.startsWith("/c/") },
  { href: "/events", label: "Events", icon: CalendarDays, match: (p: string) => p.startsWith("/events") },
  { href: "/messages", label: "Messages", icon: MessageCircle, match: (p: string) => p.startsWith("/messages") },
] as const;

export const SECONDARY_NAV = [
  { href: "/saved", label: "Saved", icon: Bookmark },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
] as const;
