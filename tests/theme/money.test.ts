import { expect, it } from 'vitest';
import { formatMoney } from '../../src/theme/money.ts';

it.each([
  [8200000, '${{amount_no_decimals_with_comma_separator}}', '$82.000'],
  [12000000, '${{amount_no_decimals_with_comma_separator}} COP', '$120.000 COP'],
  [100, '${{amount_no_decimals_with_comma_separator}}', '$1'],
  [8200000, '${{amount}}', '$82,000.00'],
  [8200000, '${{amount_no_decimals}}', '$82,000'],
  [123456, '${{amount_no_decimals}}', '$1,235'],
  [123456, '{{amount_with_comma_separator}} €', '1.234,56 €'],
  [123456, '{{amount_with_space_separator}}', '1 234,56'],
  [123456, '{{amount_with_apostrophe_separator}}', "1'234.56"],
  [123456, '{{ amount }}', '1,234.56'],
  [123456, '{{price}}', '1,234.56'],
])('formatMoney(%i, %s) is %s', (cents, format, expected) => expect(formatMoney(cents, format)).toBe(expected));
