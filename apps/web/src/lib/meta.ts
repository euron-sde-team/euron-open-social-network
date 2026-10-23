"use client";

import { useQuery } from "@tanstack/react-query";
import type { NetworkMeta } from "@open-social/api-client";
import { api } from "./api";
import { qk } from "./query-keys";
import { productName } from "./runtime-env";

/** The network's own name (set by an admin) wins over the deployment's PRODUCT_NAME. */
export function resolveProductName(meta: Pick<NetworkMeta, "networkName"> | null | undefined, fallback: string): string {
  const name = meta?.networkName?.trim();
  return name || fallback;
}

/** Public facts about the network (name, registration mode). Readable signed out; cached for minutes. */
export function useNetworkMeta() {
  return useQuery({
    queryKey: qk.meta,
    queryFn: ({ signal }) => api().meta.get(signal),
    staleTime: 5 * 60_000,
    retry: 1,
    meta: { silent: true },
  });
}

/** The product title to show: the network name when set, else the runtime PRODUCT_NAME. */
export function useProductName(): string {
  const { data } = useNetworkMeta();
  return resolveProductName(data, productName());
}
