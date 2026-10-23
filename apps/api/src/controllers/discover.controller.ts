/** /api/discover: search, typeahead, trending tags, tag pages, leaderboard. */
import type { Request, Response } from "express";
import { z } from "zod";
import { pageQuery, parse } from "../core/validate";
import * as discover from "../services/discover.service";

export async function search(req: Request, res: Response) {
  const q = parse(z.object({ q: z.string().trim().min(2).max(100), type: z.enum(["all", "people", "communities", "posts", "questions"]).default("all") }), req.query);
  res.json(await discover.search(req.actor, q.q, q.type));
}

export async function typeahead(req: Request, res: Response) {
  const q = parse(z.object({ q: z.string().trim().max(100).default("") }), req.query);
  if (!q.q) {
    res.json({ people: [], communities: [] });
    return;
  }
  res.json(await discover.typeahead(req.actor, q.q));
}

export async function trendingTags(req: Request, res: Response) {
  res.json(await discover.trendingTags(req.actor));
}

export async function tagPosts(req: Request, res: Response) {
  const { tag } = parse(z.object({ tag: z.string().max(41) }), req.params);
  const q = parse(pageQuery, req.query);
  res.json(await discover.tagPosts(req.actor, tag, { cursor: q.cursor, limit: q.limit ?? 20 }));
}

export async function leaderboard(req: Request, res: Response) {
  const q = parse(z.object({ period: z.enum(["week", "month", "all"]).default("week") }), req.query);
  res.json(await discover.leaderboard(req.actor, q.period));
}
