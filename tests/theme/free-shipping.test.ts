import { expect, it } from 'vitest';
import { barMessage, freeShippingProgress, parseSuggestionCandidates, pickSuggestion, type SuggestionCandidate } from '../../src/theme/free-shipping.ts';

const T = 12_000_000;
const messages = { remaining: "You're [amount] away from free shipping", reached: "You've got free shipping!" };
it.each([
  [3_800_000, { reached: false, remainingCents: 8_200_000, percent: 31 }],
  [11_999_900, { reached: false, remainingCents: 100, percent: 99 }],
  [12_000_000, { reached: true, remainingCents: 0, percent: 100 }],
  [13_600_000, { reached: true, remainingCents: 0, percent: 100 }],
  [0, { reached: false, remainingCents: 12_000_000, percent: 0 }],
  [-500, { reached: false, remainingCents: 12_000_000, percent: 0 }],
])('a cart total of %i cents', (total, expected) => expect(freeShippingProgress(total, T)).toEqual(expected));
it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('threshold %d disables the bar', (t) => expect(freeShippingProgress(1000, t)).toBeNull());
it('fills the remaining amount into the message', () =>
  expect(barMessage({ reached: false, remainingCents: 8_200_000, percent: 31 }, messages, '${{amount_no_decimals_with_comma_separator}}')).toBe("You're $82.000 away from free shipping"));
it('shows the reached message at the threshold', () =>
  expect(barMessage({ reached: true, remainingCents: 0, percent: 100 }, messages, '${{amount}}')).toBe("You've got free shipping!"));
it('leaves a message without [amount] as written', () =>
  expect(barMessage({ reached: false, remainingCents: 100, percent: 99 }, { ...messages, remaining: 'Almost there' }, '${{amount}}')).toBe('Almost there'));

const bag = (variantId: number, label: string, priceCents: number, available = true): SuggestionCandidate => ({ variantId, label, priceCents, price: `$${String(priceCents / 100)}`, available });
const BAGS = [
  bag(3001, 'Sierra Nevada 250 g', 3_800_000),
  bag(1001, 'Huila 250 g', 4_400_000),
  bag(2001, 'Nariño 250 g', 4_600_000),
  bag(3002, 'Sierra Nevada 500 g', 6_800_000),
];
it('pickSuggestion picks the cheapest available bag that covers the gap', () => {
  expect(pickSuggestion(BAGS, 600_000)?.label).toBe('Sierra Nevada 250 g');
  expect(pickSuggestion(BAGS, 4_500_000)?.label).toBe('Nariño 250 g');
  // Order doesn't matter, and a tie keeps the first.
  expect(pickSuggestion([...BAGS].reverse(), 600_000)?.label).toBe('Sierra Nevada 250 g');
  const twins = [bag(1, 'First', 5_000_000), bag(2, 'Second', 5_000_000)];
  expect(pickSuggestion(twins, 100)?.label).toBe('First');
  expect(pickSuggestion(BAGS, 3_800_000)?.label).toBe('Sierra Nevada 250 g');
});
it('pickSuggestion never suggests a sold-out bag, and nothing once free shipping is reached or when no bag covers the gap', () => {
  const soldOut = [bag(3001, 'Sierra Nevada 250 g', 3_800_000, false), ...BAGS.slice(1)];
  expect(pickSuggestion(soldOut, 600_000)?.label).toBe('Huila 250 g');
  expect(pickSuggestion(BAGS.map((b) => ({ ...b, available: false })), 600_000)).toBeNull();
  expect(pickSuggestion(BAGS, 0)).toBeNull();
  expect(pickSuggestion(BAGS, -100)).toBeNull();
  expect(pickSuggestion(BAGS, 7_000_000)).toBeNull();
  expect(pickSuggestion([], 600_000)).toBeNull();
});
it('parseSuggestionCandidates drops malformed entries', () => {
  const good = { variantId: 3001, label: 'Sierra Nevada 250 g', priceCents: 3_800_000, price: '$38.000', available: true };
  expect(parseSuggestionCandidates([good])).toEqual([good]);
  expect(parseSuggestionCandidates([good, null, 'x', {}, { ...good, variantId: 'a' }, { ...good, priceCents: Number.NaN }, { ...good, priceCents: -1 }, { ...good, label: '' }, { ...good, available: 'yes' }, { ...good, price: 5 }])).toEqual([good]);
  expect(parseSuggestionCandidates(null)).toEqual([]);
  expect(parseSuggestionCandidates({ not: 'a list' })).toEqual([]);
});
