export async function waitForHealthy(baseUrl: string, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return true;
    } catch {
      // not up yet; retry below until the budget runs out
    }
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
  }
}

/** n8n answers 404 for an unregistered webhook path; anything else means it's live. */
export function isWebhookLive(status: number): boolean {
  return status !== 404;
}

/**
 * The publication reconciler registers the route on its own schedule after a restart, so it can
 * 404 for a while after `/healthz` is healthy. An unauthenticated POST is safe: the webhook
 * rejects it before running anything.
 */
export async function waitForWebhookLive(
  baseUrl: string,
  path: string,
  budgetMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    try {
      const res = await fetchImpl(`${baseUrl}/webhook/${path}`, { method: 'POST', signal: AbortSignal.timeout(5000) });
      if (isWebhookLive(res.status)) return true;
    } catch {
      // not reachable yet; retry until the budget runs out
    }
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
  }
}
