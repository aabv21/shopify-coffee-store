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
