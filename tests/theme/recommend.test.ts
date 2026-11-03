import { expect, it } from 'vitest';
import { missingAnswers, parseProducts, readAnswers, recommend, type FinderProduct } from '../../src/theme/recommend.ts';

const p = (id: number, title: string, roast: string | null, brewMethod: string | null, avail: [boolean, boolean] = [true, true]): FinderProduct => ({
  id, title, url: `/products/${String(id)}`, image: null, roast, brewMethod, tastingNotes: null,
  variants: [{ id: id * 10 + 1, title: '250 g', grams: 250, available: avail[0], price: '$1' }, { id: id * 10 + 2, title: '500 g', grams: 500, available: avail[1], price: '$2' }],
});
const lightPour = p(1, 'A', 'light', 'pour-over');
const mediumPress = p(2, 'B', 'medium', 'french-press');
const darkEspresso = p(3, 'C', 'dark', 'espresso');
const catalog = [lightPour, mediumPress, darkEspresso];
const ids = (r: ReturnType<typeof recommend>) => r.map((x) => [x.product.id, x.variant.id]);

it('a perfect match comes alone', () => expect(ids(recommend(catalog, { brewMethod: 'pour-over', taste: 'mild', people: 1 }))).toEqual([[1, 11]]));
it('three or more people get the larger bag', () => expect(ids(recommend(catalog, { brewMethod: 'espresso', taste: 'intense', people: 3 }))).toEqual([[3, 32]]));
it('a partial match adds the best second option', () => {
  expect(ids(recommend(catalog, { brewMethod: 'pour-over', taste: 'intense', people: 2 }))).toEqual([[1, 11], [3, 31]]);
  expect(ids(recommend(catalog, { brewMethod: 'french-press', taste: 'mild', people: 3 }))).toEqual([[2, 22], [1, 12]]);
});
it('sold-out products are never recommended and nothing matching means no result', () =>
  expect(recommend([p(1, 'A', 'light', 'pour-over', [false, false]), mediumPress, darkEspresso], { brewMethod: 'pour-over', taste: 'mild', people: 1 })).toEqual([]));
it('falls back to the size still in stock', () =>
  expect(ids(recommend([p(3, 'C', 'dark', 'espresso', [true, false])], { brewMethod: 'espresso', taste: 'intense', people: 3 }))).toEqual([[3, 31]]));
it('products without metafields never match', () => expect(recommend([p(9, 'Z', null, null)], { brewMethod: 'espresso', taste: 'intense', people: 1 })).toEqual([]));
it('two perfect matches come together, in collection order, at most two', () => {
  const twins = [p(1, 'A', 'light', 'pour-over'), p(4, 'D', 'light', 'pour-over'), p(5, 'E', 'light', 'pour-over')];
  expect(ids(recommend(twins, { brewMethod: 'pour-over', taste: 'mild', people: 1 }))).toEqual([[1, 11], [4, 41]]);
});
it('reads complete answers and rejects anything else', () => {
  expect(readAnswers([['brew_method', 'espresso'], ['taste', 'balanced'], ['people', '2']])).toEqual({ brewMethod: 'espresso', taste: 'balanced', people: 2 });
  expect(readAnswers([['brew_method', 'espresso'], ['taste', 'balanced']])).toBeNull();
  expect(readAnswers([['brew_method', 'aeropress'], ['taste', 'balanced'], ['people', '2']])).toBeNull();
});
it('names the unanswered questions in form order, counting an unknown value as unanswered', () => {
  expect(missingAnswers([['brew_method', 'espresso'], ['taste', 'balanced'], ['people', '2']])).toEqual([]);
  expect(missingAnswers([])).toEqual(['brew_method', 'taste', 'people']);
  expect(missingAnswers([['people', '3'], ['taste', 'mild']])).toEqual(['brew_method']);
  expect(missingAnswers([['brew_method', 'aeropress'], ['taste', 'balanced'], ['people', '4']])).toEqual(['brew_method', 'people']);
});
it('drops malformed product data', () => {
  expect(parseProducts('nope')).toEqual([]);
  expect(parseProducts([{ id: 1, title: 'A', variants: [] }, { title: 'no id', variants: [{ id: 2 }] }])).toEqual([]);
});
