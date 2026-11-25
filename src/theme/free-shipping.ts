// No DOM, so it can be unit-tested directly.
import { formatMoney } from './money.ts';

export interface FreeShippingState { reached: boolean; remainingCents: number; percent: number }

export function freeShippingProgress(totalCents: number, thresholdCents: number): FreeShippingState | null {
  if (!Number.isFinite(thresholdCents) || thresholdCents <= 0) return null;

  const total = Math.max(0, totalCents);
  const reached = total >= thresholdCents;
  const remainingCents = reached ? 0 : thresholdCents - total;
  const percent = Math.min(100, Math.floor((total * 100) / thresholdCents));

  return { reached, remainingCents, percent };
}

export function barMessage(state: FreeShippingState, messages: { remaining: string; reached: string }, moneyFormat: string): string {
  if (state.reached) return messages.reached;
  return messages.remaining.replace('[amount]', formatMoney(state.remainingCents, moneyFormat));
}

export interface SuggestionCandidate { variantId: number; label: string; priceCents: number; price: string; available: boolean }

function isCandidate(value: unknown): value is SuggestionCandidate {
  if (typeof value !== 'object' || value === null) return false;
  const v = new Map(Object.entries(value as Record<string, unknown>));
  const id = v.get('variantId');
  const cents = v.get('priceCents');
  const label = v.get('label');
  return (
    typeof id === 'number' && Number.isFinite(id) &&
    typeof cents === 'number' && Number.isFinite(cents) && cents >= 0 &&
    typeof label === 'string' && label !== '' &&
    typeof v.get('price') === 'string' &&
    typeof v.get('available') === 'boolean'
  );
}

/** The bar's candidate bags as the Liquid renders them; anything malformed is dropped. */
export function parseSuggestionCandidates(data: unknown): SuggestionCandidate[] {
  return Array.isArray(data) ? (data as unknown[]).filter(isCandidate) : [];
}

/** The cheapest available bag that covers the remaining amount, the first on a price tie; null when free shipping is reached or none qualifies. */
export function pickSuggestion(candidates: readonly SuggestionCandidate[], remainingCents: number): SuggestionCandidate | null {
  if (remainingCents <= 0) return null;
  let best: SuggestionCandidate | null = null;
  for (const candidate of candidates) {
    if (!candidate.available || candidate.priceCents < remainingCents) continue;
    if (best === null || candidate.priceCents < best.priceCents) best = candidate;
  }
  return best;
}
