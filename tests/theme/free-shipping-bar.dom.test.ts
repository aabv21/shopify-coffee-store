// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/theme/free-shipping-bar.ts';
import type { UpdateCartResult } from '../../src/theme/shopify-actions.d.ts';
import { barSettings, renderBar } from '../lib/theme-render.ts';

const CART_EVENT = 'shopify:cart:lines-update';

const cartResponse = (totalCents: number) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ total_price: totalCents }) });
const stubFetch = (impl: () => Promise<unknown>) => {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};
const ticks = () => new Promise((resolve) => { setTimeout(resolve, 0); });

// Parsed inert, then inserted whole, as a browser upgrades the server's markup: the element
// connects with its children already in place.
const mount = (html: string) => {
  const template = document.createElement('template');
  template.innerHTML = html;
  document.body.append(template.content);
};
const bar = () => document.querySelector<HTMLElement>('free-shipping-bar')!;
const message = () => document.querySelector('[data-bar-message]')!.textContent;
const track = () => document.querySelector('[data-bar-track]')!;

afterEach(() => {
  document.body.replaceChildren();
  delete window.Shopify;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('free-shipping bar in the DOM', () => {
  it('the progressbar carries the percent, not the message, so the message is spoken once', async () => {
    mount(await renderBar(3_800_000));
    expect(track().hasAttribute('aria-valuetext')).toBe(false);
    expect(track().getAttribute('aria-valuenow')).toBe('31');
    stubFetch(() => cartResponse(12_000_000));
    document.dispatchEvent(new CustomEvent(CART_EVENT, { detail: { promise: Promise.resolve() } }));
    await ticks();
    expect(track().hasAttribute('aria-valuetext')).toBe(false);
    expect(track().getAttribute('aria-valuenow')).toBe('100');
  });

  it("upgrading the server render doesn't re-announce its message", async () => {
    const template = document.createElement('template');
    template.innerHTML = await renderBar(3_800_000);
    // happy-dom watches only nodes already in the observed tree when they connect, so the markup
    // joins a watched, detached host first and the host's insertion then upgrades the bar.
    const host = document.createElement('div');
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => records.push(...batch));
    observer.observe(host, { subtree: true, childList: true, characterData: true, attributes: true });
    host.append(template.content);
    document.body.append(host);
    await Promise.resolve();
    records.push(...observer.takeRecords());
    observer.disconnect();

    const messageEl = document.querySelector('[data-bar-message]')!;
    expect(records.filter((r) => messageEl.contains(r.target))).toEqual([]);
    expect(records.map((r) => r.attributeName)).not.toContain('aria-valuenow');
    expect(message()).toBe('You’re $82.000 away from free shipping');
    expect(track().getAttribute('aria-valuenow')).toBe('31');
  });

  it.each([
    ['a cart update re-reads /cart.js and shows the reached message', () => new CustomEvent(CART_EVENT, { detail: { promise: Promise.resolve() } })],
    ['a cart update event without detail still refreshes the total', () => new CustomEvent(CART_EVENT)],
  ])('%s', async (_name, event) => {
    mount(await renderBar(3_800_000));
    const fetchMock = stubFetch(() => cartResponse(15_200_000));
    document.dispatchEvent(event());
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/cart.js');
      expect(message()).toBe('You’ve got free shipping!');
      expect(bar().dataset.state).toBe('reached');
      expect(track().getAttribute('aria-valuenow')).toBe('100');
    });
  });

  it('a failed cart read keeps the last message and warns', async () => {
    mount(await renderBar(3_800_000));
    stubFetch(() => Promise.resolve({ ok: false, status: 500 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    document.dispatchEvent(new CustomEvent(CART_EVENT));
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toBe('free-shipping-bar: failed to refresh cart total');
    expect(message()).toBe('You’re $82.000 away from free shipping');
    expect(bar().dataset.state).toBe('remaining');
    expect(bar().dataset.totalCents).toBe('3800000');
  });

  it('a bar missing its children warns once, however often it renders', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mount('<free-shipping-bar data-threshold-cents="12000000" data-total-cents="0"></free-shipping-bar>');
    bar().dataset.totalCents = '100';
    bar().dataset.totalCents = '200';
    expect(warn).toHaveBeenCalledOnce();
  });

  it('a removed bar no longer listens for cart updates', async () => {
    mount(await renderBar(3_800_000));
    const fetchMock = stubFetch(() => cartResponse(15_200_000));
    bar().remove();
    document.dispatchEvent(new CustomEvent(CART_EVENT));
    await ticks();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a zero threshold hides the bar', async () => {
    mount(await renderBar(3_800_000));
    expect(bar().hidden).toBe(false);
    bar().dataset.thresholdCents = '0';
    bar().dataset.totalCents = '4000000';
    expect(bar().hidden).toBe(true);
  });
});

const suggestion = () => document.querySelector<HTMLElement>('[data-bar-suggestion]')!;
const suggestionText = () => document.querySelector('[data-suggestion-text]')!.textContent;
const addButton = () => document.querySelector<HTMLButtonElement>('[data-suggestion-add]')!;
const suggestionStatus = () => document.querySelector('[data-suggestion-status]')!.textContent;
const stubActions = (updateCart: () => Promise<UpdateCartResult>) => {
  const actions = { updateCart: vi.fn(updateCart), openCart: vi.fn(() => Promise.resolve()) };
  window.Shopify = { actions };
  return actions;
};

describe('free-shipping bar suggestion', () => {
  it('at 114,000 COP the bar suggests Sierra Nevada 250 g for $38.000', async () => {
    mount(await renderBar(11_400_000));
    expect(suggestion().hidden).toBe(false);
    expect(suggestionText()).toBe('Add Sierra Nevada 250 g ($38.000) and shipping is free.');
    expect(addButton().textContent.trim()).toBe('Add');
  });

  it('speaks Spanish in a Spanish storefront', async () => {
    mount(await renderBar(11_400_000, 'es'));
    expect(suggestionText()).toBe('Agregue Sierra Nevada 250 g ($38.000) y el envío le sale gratis.');
    expect(addButton().textContent.trim()).toBe('Agregar');
  });

  it('Add puts the suggested variant in the cart without opening the drawer', async () => {
    mount(await renderBar(11_400_000));
    const actions = stubActions(() => Promise.resolve({}));
    stubFetch(() => cartResponse(15_200_000));
    addButton().click();
    await vi.waitFor(() => expect(actions.updateCart).toHaveBeenCalled());
    const [payload] = actions.updateCart.mock.calls[0] as unknown as [{ lines: { merchandiseId: string; quantity: number }[] }];
    expect(payload.lines).toHaveLength(1);
    expect(payload.lines[0]?.quantity).toBe(1);
    expect(actions.openCart).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(message()).toBe('You’ve got free shipping!'));
    expect(suggestion().hidden).toBe(true);
  });

  it('a failed add shows the suggestion error', async () => {
    mount(await renderBar(11_400_000));
    stubActions(() => Promise.resolve({ userErrors: [{ message: 'x' }] }));
    addButton().click();
    await vi.waitFor(() => expect(suggestionStatus()).toBe('We couldn’t add it. Please try again.'));
    expect(addButton().hasAttribute('aria-busy')).toBe(false);
    expect(suggestion().hidden).toBe(false);
  });

  it('a failed cart re-read after a successful add only warns: the add did not fail', async () => {
    mount(await renderBar(11_400_000));
    const actions = stubActions(() => Promise.resolve({}));
    stubFetch(() => Promise.resolve({ ok: false, status: 500 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    addButton().click();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(actions.updateCart).toHaveBeenCalledOnce();
    expect(suggestionStatus()).toBe('');
    expect(addButton().hasAttribute('aria-busy')).toBe(false);
  });

  it('after an add that reaches free shipping, focus moves to the bar message instead of falling to the page', async () => {
    mount(await renderBar(11_400_000));
    stubActions(() => Promise.resolve({}));
    stubFetch(() => cartResponse(15_200_000));
    addButton().focus();
    expect(document.activeElement).toBe(addButton());
    addButton().click();
    await vi.waitFor(() => expect(suggestion().hidden).toBe(true));
    expect(document.activeElement).toBe(document.querySelector('[data-bar-message]'));
    expect(document.querySelector('[data-bar-message]')!.getAttribute('tabindex')).toBe('-1');
  });

  it('focus elsewhere is left alone when the suggestion hides', async () => {
    mount(await renderBar(11_400_000));
    const other = document.createElement('button');
    document.body.append(other);
    other.focus();
    stubFetch(() => cartResponse(15_200_000));
    document.dispatchEvent(new CustomEvent(CART_EVENT));
    await vi.waitFor(() => expect(suggestion().hidden).toBe(true));
    expect(document.activeElement).toBe(other);
  });

  it('a rejected add shows the suggestion error too', async () => {
    mount(await renderBar(11_400_000));
    stubActions(() => Promise.reject(new Error('network')));
    addButton().click();
    await vi.waitFor(() => expect(suggestionStatus()).toBe('We couldn’t add it. Please try again.'));
  });

  it('at free shipping the suggestion hides', async () => {
    mount(await renderBar(15_200_000));
    expect(suggestion().hidden).toBe(true);
  });

  it('the suggestion follows the cart: it hides when an update reaches free shipping', async () => {
    mount(await renderBar(11_400_000));
    stubFetch(() => cartResponse(15_200_000));
    document.dispatchEvent(new CustomEvent(CART_EVENT));
    await vi.waitFor(() => expect(suggestion().hidden).toBe(true));
  });

  it('no suggestion when no bag covers the gap', async () => {
    mount(await renderBar(0));
    expect(suggestion().hidden).toBe(true);
  });

  it('with the suggestion turned off, nothing renders', async () => {
    expect(barSettings.free_shipping_suggestion_enabled).toBe(true);
    mount(await renderBar(11_400_000, 'en', { free_shipping_suggestion_enabled: false }));
    expect(document.querySelector('[data-bar-suggestion]')).toBeNull();
    expect(document.querySelector('[data-bar-suggestions]')).toBeNull();
    expect(message()).toBe('You’re $6.000 away from free shipping');
  });
});
