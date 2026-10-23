/** Public facts about the network: what the web app needs before anyone signs in. */
import type { NetworkMeta } from "@open-social/types";
import type { Request, Response } from "express";
import { getSettings, networkName } from "../services/settings.service";

export async function meta(_req: Request, res: Response) {
  const body: NetworkMeta = { networkName: await networkName(), registration: (await getSettings()).registration };
  res.setHeader("Cache-Control", "public, max-age=30");
  res.json(body);
}
