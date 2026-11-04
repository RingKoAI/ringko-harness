// Usage statistics endpoint.

import { backendClient } from "./http";
import type { UsageStatistics, UsageStatisticsQuery } from "@ringko-ai/client";

export function fetchUsageStatistics(query: UsageStatisticsQuery, signal?: AbortSignal): Promise<UsageStatistics> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
  return backendClient.request(`/api/usage?${params}`, undefined, 'GET', signal);
}
