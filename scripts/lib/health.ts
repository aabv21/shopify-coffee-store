/** Polls `${baseUrl}/healthz` once a second until it responds OK or `budgetMs` elapses, with a 5 s timeout per request. */
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

/** True once a status means the webhook is registered and live — anything but 404 (n8n's "not found" for an unknown path). */
export function isWebhookLive(status: number): boolean {
  return status !== 404;
}

/**
 * Polls `${baseUrl}/webhook/${path}` with an unauthenticated POST, once a second, until
 * `isWebhookLive` is true or `budgetMs` elapses. `publish:workflow` only takes effect after an
 * n8n restart, and the publication reconciler that actually registers the webhook route runs on
 * its own schedule after that (10 s by default) — so a call made right after `/healthz` turns
 * healthy can still 404 for a few more seconds. Both this repo's webhook targets (the dev harness
 * and the Shopify Trigger) reject or accept a request before running anything behind them, so an
 * unauthenticated probe answers something other than 404 the moment the route is live, with no
 * credential needed. `fetchImpl` is injectable so the polling logic can be unit-tested with no
 * real network.
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
      // not registered yet, or n8n isn't reachable for a moment; retry below until the budget runs out
    }
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
  }
}
