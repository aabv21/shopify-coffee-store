// Covers Shopify's money_format placeholders well enough for the free-shipping bar.

interface Separators { thousands: string; decimal: string }

const DEFAULT_SEPARATORS: Separators = { thousands: ',', decimal: '.' };

const SEPARATORS = new Map<string, Separators>([
  ['amount', DEFAULT_SEPARATORS],
  ['amount_no_decimals', { thousands: ',', decimal: '.' }],
  ['amount_with_comma_separator', { thousands: '.', decimal: ',' }],
  ['amount_no_decimals_with_comma_separator', { thousands: '.', decimal: ',' }],
  ['amount_with_space_separator', { thousands: ' ', decimal: ',' }],
  ['amount_no_decimals_with_space_separator', { thousands: ' ', decimal: ',' }],
  ['amount_with_period_and_space_separator', { thousands: ' ', decimal: '.' }],
  ['amount_with_apostrophe_separator', { thousands: "'", decimal: '.' }],
]);

const NO_DECIMALS = new Set(['amount_no_decimals', 'amount_no_decimals_with_comma_separator', 'amount_no_decimals_with_space_separator']);

function roundHalfUp(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// A loop, not a regex: no backtracking risk, on at most ~20 digits from toFixed.
function groupThousands(digits: string, separator: string): string {
  let result = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) result += separator;
    result += digits.charAt(i);
  }
  return result;
}

function formatPlaceholder(cents: number, placeholder: string): string {
  const decimals = NO_DECIMALS.has(placeholder) ? 0 : 2;
  const { thousands, decimal } = SEPARATORS.get(placeholder) ?? DEFAULT_SEPARATORS;

  const units = roundHalfUp(cents / 100, decimals);
  const [wholePart, decimalPart] = units.toFixed(decimals).split('.');
  const whole = groupThousands(wholePart ?? '0', thousands);

  return decimalPart === undefined ? whole : `${whole}${decimal}${decimalPart}`;
}

export function formatMoney(cents: number, format: string): string {
  return format.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match: string, placeholder: string) => formatPlaceholder(cents, placeholder));
}
