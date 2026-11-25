// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addToCart } from '../../src/theme/cart-add.ts';
import type { UpdateCartResult } from '../../src/theme/shopify-actions.d.ts';

const OPTIONS = { cartAddUrl: '/cart/add', cartUrl: '/cart', openCart: true };

const stubActions = (updateCart: () => Promise<UpdateCartResult>, openCart: () => Promise<void> = () => Promise.resolve()) => {
  const actions = { updateCart: vi.fn(updateCart), openCart: vi.fn(openCart) };
  window.Shopify = { actions };
  return actions;
};

afterEach(() => {
  delete window.Shopify;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('addToCart through Shopify.actions', () => {
  it('sends the variant and opens the cart', async () => {
    const actions = stubActions(() => Promise.resolve({}));
    expect(await addToCart('2001', OPTIONS)).toEqual({ ok: true, warnings: [] });
    expect(actions.updateCart).toHaveBeenCalledWith({ lines: [{ merchandiseId: '2001', quantity: 1 }] }, { event: { context: 'standard-action' } });
    expect(actions.openCart).toHaveBeenCalled();
  });

  it('userErrors fail the add and never open the cart', async () => {
    const actions = stubActions(() => Promise.resolve({ userErrors: [{ message: 'x' }] }));
    expect(await addToCart('2001', OPTIONS)).toEqual({ ok: false, warnings: [] });
    expect(actions.openCart).not.toHaveBeenCalled();
  });

  it('returns the warnings with a successful add', async () => {
    stubActions(() => Promise.resolve({ warnings: [{ message: 'Only 3 left.' }] }));
    expect(await addToCart('2001', OPTIONS)).toEqual({ ok: true, warnings: ['Only 3 left.'] });
  });

  it('a failed openCart still reports the add and only warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubActions(() => Promise.resolve({}), () => Promise.reject(new Error('drawer')));
    expect(await addToCart('2001', OPTIONS)).toEqual({ ok: true, warnings: [] });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('a rejected updateCart propagates to the caller', async () => {
    stubActions(() => Promise.reject(new Error('network')));
    await expect(addToCart('2001', OPTIONS)).rejects.toThrow('network');
  });

  it('openCart: false never opens the drawer', async () => {
    const actions = stubActions(() => Promise.resolve({}));
    expect(await addToCart('2001', { ...OPTIONS, openCart: false })).toEqual({ ok: true, warnings: [] });
    expect(actions.openCart).not.toHaveBeenCalled();
  });
});

describe('addToCart through the Cart AJAX fallback', () => {
  it('posts the variant and goes to the cart', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    expect(await addToCart('2001', OPTIONS)).toEqual({ ok: true, warnings: [] });
    expect(assign).toHaveBeenCalledWith('/cart');
    expect(fetchMock).toHaveBeenCalledWith('/cart/add.js', expect.objectContaining({ method: 'POST', body: '{"items":[{"id":2001,"quantity":1}]}' }));
  });

  it('a failed add reports it and stays on the page', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false })));
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    expect(await addToCart('2001', OPTIONS)).toEqual({ ok: false, warnings: [] });
    expect(assign).not.toHaveBeenCalled();
  });

  it('openCart: false adds without leaving the page', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true })));
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    expect(await addToCart('2001', { ...OPTIONS, openCart: false })).toEqual({ ok: true, warnings: [] });
    expect(assign).not.toHaveBeenCalled();
  });
});
