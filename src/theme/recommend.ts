// No DOM, so it can be unit-tested directly.

export type BrewMethod = 'pour-over' | 'espresso' | 'french-press';
export type Taste = 'mild' | 'balanced' | 'intense';

export interface FinderVariant { id: number; title: string; grams: number; available: boolean; price: string }
export interface FinderProduct {
  id: number;
  title: string;
  url: string;
  image: { src: string; alt: string } | null;
  roast: string | null;
  brewMethod: string | null;
  tastingNotes: string | null;
  variants: FinderVariant[];
}
export interface FinderAnswers { brewMethod: BrewMethod; taste: Taste; people: 1 | 2 | 3 }
export interface Recommendation { product: FinderProduct; variant: FinderVariant }

export const TASTE_TO_ROAST: Readonly<Record<Taste, 'light' | 'medium' | 'dark'>> = {
  mild: 'light',
  balanced: 'medium',
  intense: 'dark',
};

/** Radio-group names, in form order. */
export const QUESTIONS = ['brew_method', 'taste', 'people'] as const;
export type Question = (typeof QUESTIONS)[number];

const BREW_METHODS: readonly BrewMethod[] = ['pour-over', 'espresso', 'french-press'];
const TASTES: readonly Taste[] = ['mild', 'balanced', 'intense'];
const PEOPLE = new Set([1, 2, 3]);

function isBrewMethod(value: unknown): value is BrewMethod {
  return typeof value === 'string' && BREW_METHODS.includes(value as BrewMethod);
}

function isTaste(value: unknown): value is Taste {
  return typeof value === 'string' && TASTES.includes(value as Taste);
}

function isPeople(value: unknown): value is string {
  return typeof value === 'string' && PEOPLE.has(Number(value));
}

/** The best variant for a given party size: lightest available for 1–2 people, heaviest for 3, keeping the first on a tie. */
function pickVariant(variants: readonly FinderVariant[], people: 1 | 2 | 3): FinderVariant | null {
  const available = variants.filter((v) => v.available);
  if (available.length === 0) return null;

  let best = available[0];
  for (const variant of available.slice(1)) {
    if (!best) { best = variant; continue; }
    const lighter = variant.grams < best.grams;
    const heavier = variant.grams > best.grams;
    if ((people === 3 && heavier) || (people !== 3 && lighter)) best = variant;
  }
  return best ?? null;
}

function score(product: FinderProduct, answers: FinderAnswers): number {
  let total = 0;
  if (product.brewMethod === answers.brewMethod) total += 2;
  if (product.roast === TASTE_TO_ROAST[answers.taste]) total += 1;
  return total;
}

export function recommend(products: readonly FinderProduct[], answers: FinderAnswers): Recommendation[] {
  const available = products.filter((product) => product.variants.some((v) => v.available));

  const scored = available
    .map((product) => ({ product, points: score(product, answers) }))
    .filter((entry) => entry.points > 0);

  scored.sort((a, b) => b.points - a.points);

  const bestScore = scored[0]?.points ?? 0;
  const chosen = bestScore === 3 ? scored.filter((entry) => entry.points === 3) : scored;

  const picks: Recommendation[] = [];
  for (const entry of chosen.slice(0, 2)) {
    const variant = pickVariant(entry.product.variants, answers.people);
    if (variant) picks.push({ product: entry.product, variant });
  }
  return picks;
}

export function readAnswers(entries: Iterable<[string, unknown]>): FinderAnswers | null {
  let brewMethod: BrewMethod | null = null;
  let taste: Taste | null = null;
  let people: 1 | 2 | 3 | null = null;

  for (const [key, value] of entries) {
    if (key === 'brew_method' && isBrewMethod(value)) brewMethod = value;
    else if (key === 'taste' && isTaste(value)) taste = value;
    else if (key === 'people' && isPeople(value)) people = Number(value) as 1 | 2 | 3;
  }

  if (brewMethod === null || taste === null || people === null) return null;
  return { brewMethod, taste, people };
}

/** The questions a submission leaves unanswered (or answers with an unknown value), in form order. */
export function missingAnswers(entries: Iterable<[string, unknown]>): Question[] {
  const answered = new Set<Question>();
  for (const [key, value] of entries) {
    if (key === 'brew_method' && isBrewMethod(value)) answered.add('brew_method');
    else if (key === 'taste' && isTaste(value)) answered.add('taste');
    else if (key === 'people' && isPeople(value)) answered.add('people');
  }
  return QUESTIONS.filter((question) => !answered.has(question));
}

function parseVariant(value: unknown): FinderVariant | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'number') return null;
  return {
    id: v.id,
    title: typeof v.title === 'string' ? v.title : '',
    grams: typeof v.grams === 'number' ? v.grams : 0,
    available: v.available === true,
    price: typeof v.price === 'string' ? v.price : '',
  };
}

function parseProduct(value: unknown): FinderProduct | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'number' || typeof v.title !== 'string') return null;
  if (!Array.isArray(v.variants)) return null;

  const variants = v.variants.map(parseVariant).filter((variant) => variant !== null);
  if (variants.length === 0) return null;

  return {
    id: v.id,
    title: v.title,
    url: typeof v.url === 'string' ? v.url : '',
    image: parseImage(v.image),
    roast: typeof v.roast === 'string' ? v.roast : null,
    brewMethod: typeof v.brewMethod === 'string' ? v.brewMethod : null,
    tastingNotes: typeof v.tastingNotes === 'string' ? v.tastingNotes : null,
    variants,
  };
}

/** Shopify serves an unset alt text as null, which must render as alt="", never the word "null". */
function parseImage(value: unknown): FinderProduct['image'] {
  if (typeof value !== 'object' || value === null) return null;
  const { src, alt } = value as Record<string, unknown>;
  if (typeof src !== 'string' || src === '') return null;
  return { src, alt: typeof alt === 'string' ? alt : '' };
}

export function parseProducts(data: unknown): FinderProduct[] {
  if (!Array.isArray(data)) return [];
  const products: FinderProduct[] = [];
  for (const entry of data) {
    const product = parseProduct(entry);
    if (product) products.push(product);
  }
  return products;
}
