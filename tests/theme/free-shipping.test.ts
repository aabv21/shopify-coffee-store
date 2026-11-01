import { expect, it } from 'vitest';
import { barMessage, freeShippingProgress } from '../../src/theme/free-shipping.ts';

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
