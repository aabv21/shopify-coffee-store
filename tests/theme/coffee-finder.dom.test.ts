// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/theme/coffee-finder.ts';
import type { UpdateCartResult } from '../../src/theme/shopify-actions.d.ts';
import type { MockProduct } from '../../scripts/lib/theme-preview.ts';
import { catalog, renderFinder } from '../lib/theme-render.ts';

const ADDED = 'Added to your cart.';
const ERROR = 'We couldn’t add this to your cart. Please try again.';

// Parsed inert, then inserted whole, as a browser upgrades the server's markup.
const mount = async (o: { products?: MockProduct[] } = {}) => {
  const template = document.createElement('template');
  template.innerHTML = await renderFinder(o);
  document.body.append(template.content);
};
const form = () => document.querySelector<HTMLFormElement>('[data-finder-form]')!;
const fieldset = (name: string) => document.querySelector(`input[name="${name}"]`)!.closest('fieldset')!;
const check = (name: string, value: string) => {
  document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!.checked = true;
};
// The preview's image_url stub, which the section asks for at 400 px wide.
const withWidth400 = (src: string) => { const url = new URL(src); url.searchParams.set('width', '400'); return url.toString(); };
const cards = () => [...document.querySelectorAll('[data-finder-list] > li')];
const status = () => document.querySelector<HTMLElement>('[data-card-status]')!;

/** Answers "Pour-over / Mild and bright / Just me" and returns the one card's add button. */
const recommendNarino = async (o: { products?: MockProduct[] } = {}) => {
  await mount(o);
  check('brew_method', 'pour-over');
  check('taste', 'mild');
  check('people', '1');
  form().requestSubmit();
  return document.querySelector<HTMLButtonElement>('[data-card-add]')!;
};

const stubActions = (updateCart: () => Promise<UpdateCartResult>, openCart: () => Promise<void> = () => Promise.resolve()) => {
  const actions = { updateCart: vi.fn(updateCart), openCart: vi.fn(openCart) };
  window.Shopify = { actions };
  return actions;
};

afterEach(() => {
  document.body.replaceChildren();
  delete window.Shopify;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('coffee finder questions', () => {
  it('an incomplete submit flags the unanswered questions and focuses the first', async () => {
    await mount();
    check('brew_method', 'pour-over');
    form().requestSubmit();

    expect(fieldset('brew_method').hasAttribute('data-unanswered')).toBe(false);
    for (const name of ['taste', 'people']) {
      expect(fieldset(name).hasAttribute('data-unanswered')).toBe(true);
      for (const radio of document.querySelectorAll(`input[name="${name}"]`)) expect(radio.getAttribute('aria-invalid')).toBe('true');
    }
    expect((document.activeElement as HTMLInputElement).name).toBe('taste');
    expect(document.querySelector('[data-finder-error]')!.textContent).toBe('Choose an answer for each question.');
  });

  it('answering a flagged question clears its flag', async () => {
    await mount();
    form().requestSubmit();
    check('taste', 'mild');
    form().dispatchEvent(new Event('change', { bubbles: true }));
    expect(fieldset('taste').hasAttribute('data-unanswered')).toBe(false);
    expect(fieldset('people').hasAttribute('data-unanswered')).toBe(true);
  });

  it('pour-over, mild, just me recommends Nariño 250 g and focuses the results heading', async () => {
    await recommendNarino();
    expect(cards()).toHaveLength(1);
    expect(document.querySelector('[data-card-title]')!.textContent).toBe('Nariño');
    expect(document.querySelector('[data-card-variant]')!.textContent).toBe('250 g');
    expect(document.querySelector('[data-card-price]')!.textContent).toBe('$46.000');
    expect(document.activeElement).toBe(document.querySelector('[data-finder-heading]'));
  });

  it("a product image renders with the merchant's alt text", async () => {
    const narino = catalog()[0]!.featured_image!;
    await recommendNarino();
    const image = document.querySelector<HTMLImageElement>('[data-card-image]')!;
    expect(image.hidden).toBe(false);
    expect(image.getAttribute('src')).toBe(withWidth400(narino.src));
    expect(image.getAttribute('alt')).toBe(narino.alt);
    expect(narino.alt).not.toBe('');
  });

  it('a product image without alt text renders alt=""', async () => {
    const products = catalog();
    const narino = products[0]!;
    narino.featured_image = { ...narino.featured_image!, alt: null as unknown as string };
    await recommendNarino({ products });
    const image = document.querySelector<HTMLImageElement>('[data-card-image]')!;
    expect(image.hidden).toBe(false);
    expect(image.getAttribute('src')).toBe(withWidth400(narino.featured_image.src));
    expect(image.getAttribute('alt')).toBe('');
  });
});

describe('coffee finder add to cart', () => {
  it('Add to cart through Shopify.actions sends the variant and opens the cart', async () => {
    const actions = stubActions(() => Promise.resolve({}));
    const button = await recommendNarino();
    button.click();
    await vi.waitFor(() => expect(status().dataset.state).toBe('success'));
    expect(actions.updateCart).toHaveBeenCalledWith({ lines: [{ merchandiseId: '2001', quantity: 1 }] }, { event: { context: 'standard-action' } });
    expect(actions.openCart).toHaveBeenCalled();
    expect(status().textContent).toBe(ADDED);
    expect(button.hasAttribute('aria-busy')).toBe(false);
  });

  it('userErrors show the error text', async () => {
    const actions = stubActions(() => Promise.resolve({ userErrors: [{ message: 'x' }] }));
    (await recommendNarino()).click();
    await vi.waitFor(() => expect(status().dataset.state).toBe('error'));
    expect(status().textContent).toBe(ERROR);
    expect(actions.openCart).not.toHaveBeenCalled();
  });

  it('warnings follow the added text', async () => {
    stubActions(() => Promise.resolve({ warnings: [{ message: 'Only 3 left.' }] }));
    (await recommendNarino()).click();
    await vi.waitFor(() => expect(status().textContent).toBe('Added to your cart. Only 3 left.'));
  });

  it('a failed openCart still reports the add and only warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const button = await recommendNarino();
    stubActions(() => Promise.resolve({}), () => Promise.reject(new Error('drawer')));
    button.click();
    await vi.waitFor(() => expect(button.hasAttribute('aria-busy')).toBe(false));
    expect(status().dataset.state).toBe('success');
    expect(status().textContent).toBe(ADDED);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('a second press while busy adds nothing', async () => {
    const actions = stubActions(() => new Promise<UpdateCartResult>(() => undefined));
    const button = await recommendNarino();
    button.focus();
    button.click();
    button.click();
    await Promise.resolve();
    expect(actions.updateCart).toHaveBeenCalledOnce();
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(document.activeElement).toBe(button);
  });

  it('a rejected updateCart shows the error text and clears aria-busy', async () => {
    stubActions(() => Promise.reject(new Error('network')));
    const button = await recommendNarino();
    button.click();
    await vi.waitFor(() => expect(status().dataset.state).toBe('error'));
    expect(status().textContent).toBe(ERROR);
    expect(button.hasAttribute('aria-busy')).toBe(false);
  });

  it('without Shopify.actions, the Cart AJAX fallback adds and goes to the cart', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    (await recommendNarino()).click();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/cart'));
    expect(fetchMock).toHaveBeenCalledWith('/cart/add.js', expect.objectContaining({ method: 'POST', body: '{"items":[{"id":2001,"quantity":1}]}' }));
    expect(status().textContent).toBe(ADDED);
  });

  it('a failed Cart AJAX add shows the error text and stays on the page', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    (await recommendNarino()).click();
    await vi.waitFor(() => expect(status().dataset.state).toBe('error'));
    expect(status().textContent).toBe(ERROR);
    expect(assign).not.toHaveBeenCalled();
  });
});
